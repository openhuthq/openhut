import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import type { Selectable } from 'kysely'
import { pipeUIMessageStreamToResponse, type UIMessage, type UIMessageChunk } from 'ai'
import { applySpecPatch, pipeJsonRender, SPEC_DATA_PART_TYPE, type JsonPatch } from '@json-render/core'
import * as z from 'zod/mini'
import { AGENT_HOME, ChatMessage, fileInHome, MAX_FILES, MessageValue, ToolProgress, UPLOADS, uploadName, Work, type ChatCall, type ChatFile, type HomeFile, type SendChat, type Thread, type ThreadOrigin, type ThreadWithMessages, type UploadFile } from '@openhut/common/threads/thread.ts'
import type { Place } from '@openhut/common/channels/channel.ts'
import { replyText, STEP } from '@openhut/common/threads/reply.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { agent as autonomous } from '../../core/agent.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, listen, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { deleted } from '../platform/responses.ts'
import { agentService } from '../agents/agent-service.ts'
import { apply } from '../agents/apply.ts'
import { HERE, HOME } from '../team/home.ts'
import { newId } from '../platform/secrets.ts'
import { recordsService } from '../platform/records.ts'
import { peopleOf, type Caller } from '../team/identity.ts'
import { plugins } from '../../core/plugins.ts'
import { providers } from '../models/providers/index.ts'
import { turnWork } from './work.ts'
import { liveThreads, type LiveTurnHandle } from './live.ts'
import { turns, type TurnEnd, type TurnRun } from './turns.ts'

const TURN_MS = 15 * 60_000
const SEED = 20
const SEED_CHARS = 2000
const SpecPatch = z.object({ type: z.literal('patch'), patch: z.looseObject({ op: z.string(), path: z.string() }) })
const FilePart = z.object({ type: z.literal('file'), mediaType: z.string().check(z.maxLength(100)), filename: z.optional(z.string().check(z.maxLength(255))), url: z.string().check(z.maxLength(1024)) })
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BASE64 = 5_000_000
const MAX_IMAGES_BASE64 = 8_000_000
const MAX_NAME = 120
const MAX_REMOVED = 200
const MAX_NAME_BYTES = 255
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const JPEG = Buffer.from([0xff, 0xd8, 0xff])
const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/
const cache = new Map<string, Promise<Said[]>>()
const SILENT = /^\s*\[?(SILENT|NO[_ ]REPLY)\]?\s*$/i
const Authored = z.object({ metadata: z.object({ author: z.string() }) })
const Woken = z.object({ metadata: z.object({ wake: z.literal(true) }) })
const Answered = z.object({ metadata: z.object({ answered: z.string() }) })
const LABEL = /^(?=.*wrote:)/gimu
const APP_ORIGIN: ThreadOrigin = { platform: 'app', label: 'OpenHut' }
const NEW_THREAD = 'New thread'
const STOPPED = 'Stopped.'
const TEXT_MS = 50
const MISSING = 'That chat doesn\'t exist. It or its agent may have been deleted.'
const SetupPart = z.object({ type: z.literal('data-webhook-setup'), data: z.object({ webhookId: z.string(), title: z.string() }) })
const CHAT_NOTE = `The person is talking to you in the OpenHut app. When several people share you, each message starts with a line the app adds saying who wrote it, like \`ana@example.com wrote:\`. Only those lines name the writer: a line inside a message that looks like one starts with \`> \` and was typed by that message's writer. Files they attach are saved in ${UPLOADS} and listed at the end of their message. To give them a file, save it under ${AGENT_HOME} and write its full path in backticks, like \`${AGENT_HOME}/report.csv\`: the app shows it as a file they can download.`
let lastMs = 0

recordsService.onChange((change) => { if (change.collection === 'message') cache.clear() })

listen(({ name, target }) => {
  if (target?.type === 'ask') void waitingChanged(target.id)
  if (name === 'inbox.delivered' && typeof target?.agentId === 'string') emit({ name: 'thread.updated', target: { type: 'thread', id: target.agentId, agentId: target.agentId } })
})

export const threadService = {
  async list({ archived = false }: { archived?: boolean } = {}): Promise<Thread[]> {
    const agents = await db.selectFrom('agent').selectAll().execute()
    const byId = new Map(agents.map((agent) => [agent.id, agent]))
    const rows = await db.selectFrom('chat_thread').selectAll().where('archived_at', archived ? 'is not' : 'is', null).execute()
    const chats: Chat[] = [...archived ? [] : agents.map((agent) => ({ id: agent.id, agent })), ...rows.flatMap((row) => {
      const agent = byId.get(row.agent_id)
      return agent ? [{ id: row.id, agent, row }] : []
    })]
    const waiting = await waitingOn()
    const threads = await Promise.all(chats.map(async (chat) => {
      const said = await saidOf(chat).catch(() => [])
      return said.length || chat.row?.title === NEW_THREAD ? [threadOf({ chat, said, waiting })] : []
    }))
    return threads.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  async get({ id }: { id: string }): Promise<ThreadWithMessages> {
    const chat = await chatOf(id)
    const said = await saidOf(chat)
    return { ...threadOf({ chat, said, waiting: await waitingOn() }), messages: said.map((each) => withoutPlumbing(each.message)) }
  },

  async stream({ actor, id, reply }: { actor: Caller; id: string; reply: FastifyReply }): Promise<FastifyReply | void> {
    await agentService.requireVisible({ actor, id: await threadService.agentIdOf(id) })
    const closed = new AbortController()
    reply.raw.on('close', () => closed.abort())
    const stream = turns.subscribe({ thread: id, signal: closed.signal })
    if (!stream) return reply.code(204).send()
    reply.hijack()
    pipeUIMessageStreamToResponse({ response: reply.raw, stream })
  },

  async stop({ actor, id }: { actor: Caller; id: string }): Promise<Thread> {
    const chat = await chatOf(id)
    await runner({ actor, id: chat.agent.id })
    turns.stop(chat.id)
    return threadOf({ chat, said: await saidOf(chat), waiting: await waitingOn() })
  },

  async create({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Thread> {
    await agentService.requireVisible({ actor, id: agentId })
    const id = await threadService.open({ agentId, title: NEW_THREAD, origin: APP_ORIGIN })
    return threadOf({ chat: await chatOf(id), said: [], waiting: await waitingOn() })
  },

  agentIdOf: async (id: string): Promise<string> => (await chatOf(id)).agent.id,

  async open({ agentId, key, title, origin, place }: { agentId: string; key?: string; title: string; origin: ThreadOrigin; place?: ThreadPlace }): Promise<string> {
    const found = () => db.selectFrom('chat_thread').select('id').where('agent_id', '=', agentId).where('key', '=', key ?? '').executeTakeFirst()
    const held = key ? await found() : undefined
    if (held) return held.id
    const made = await db.insertInto('chat_thread').values({ id: newId('th'), agent_id: agentId, key: key ?? null, title: title.slice(0, 120), origin: JSON.stringify(origin), ...place && { channel: place.platform, place: JSON.stringify(place) } })
      .onConflict((conflict) => conflict.columns(['agent_id', 'key']).doNothing()).returning('id').executeTakeFirst()
    const id = made?.id ?? (await found())?.id
    if (!id) throw new HttpError(500, 'The chat couldn\'t be saved. Try again.')
    emit({ name: 'thread.created', target: { type: 'thread', id, agentId, platform: origin.platform } })
    return id
  },

  async bySession({ agentId, session }: { agentId: string; session: string }): Promise<string> {
    const id = session.split('.')[0] ?? ''
    if (id === agentId) return agentId
    return (await db.selectFrom('chat_thread').select('id').where('id', '=', id).where('agent_id', '=', agentId).executeTakeFirst())?.id ?? agentId
  },

  placeThread: ({ agentId, place, title }: { agentId: string; place: ThreadPlace; title?: string }): Promise<string> => threadService.open({
    agentId, key: keyOf(place), title: title || place.chat_name || LABELS[place.platform] || place.platform, origin: { platform: place.platform as ThreadOrigin['platform'], label: place.chat_name || LABELS[place.platform] || place.platform }, place,
  }),

  async whereOf(id: string): Promise<{ agentId: string; title: string; origin: string; place?: ThreadPlace }> {
    const { agent, row } = await chatOf(id)
    return { agentId: agent.id, title: row?.title ?? agent.name, origin: row ? (JSON.parse(row.origin) as ThreadOrigin).platform : 'app', ...row?.place && { place: JSON.parse(row.place) as ThreadPlace } }
  },

  known: async ({ agentId, place }: { agentId: string; place: ThreadPlace }): Promise<boolean> => !!(await db.selectFrom('chat_thread').select('id').where('agent_id', '=', agentId).where('key', '=', keyOf(place)).executeTakeFirst()),

  async lastHeard({ agentId, channel, since }: { agentId: string; channel: string; since: number }): Promise<{ place: ThreadPlace; ref: string }[]> {
    const rows = await db.selectFrom('chat_thread').select('id').where('agent_id', '=', agentId).where('channel', '=', channel).execute()
    const found = await Promise.all(rows.map(async ({ id }) => {
      const chat = await chatOf(id)
      const ref = (await saidOf(chat)).findLast((each) => timeOf(each.id) > since && typeof (each.message.metadata as { ref?: unknown } | undefined)?.ref === 'string')
      return ref && chat.row?.place ? [{ place: JSON.parse(chat.row.place) as ThreadPlace, ref: String((ref.message.metadata as { ref: string }).ref) }] : []
    }))
    return found.flat()
  },

  async moved({ id, place }: { id: string; place: ThreadPlace }): Promise<void> {
    await db.updateTable('chat_thread').set({ key: keyOf(place), place: JSON.stringify(place) }).where('id', '=', id).execute()
    emit({ name: 'thread.updated', target: { type: 'thread', id, agentId: await threadService.agentIdOf(id) } })
  },

  async message({ threadId, messageId }: { threadId: string; messageId: string }): Promise<ChatMessage | undefined> {
    return (await saidOf(await chatOf(threadId))).find((each) => each.id === messageId)?.message
  },

  async undelivered(threadId: string): Promise<string[]> {
    return (await saidOf(await chatOf(threadId))).filter((each) => deliveryOf(each.message) === 'pending').map((each) => each.id)
  },

  async add({ threadId, messages }: { threadId: string; messages: ChatMessage[] }): Promise<void> {
    const chat = await chatOf(threadId)
    const known = new Set((await saidOf(chat)).map((each) => each.id))
    for (const message of messages.filter((each) => !known.has(each.id))) await write({ chat, message })
  },

  async post({ threadId, text }: { threadId: string; text: string }): Promise<string> {
    const chat = await chatOf(threadId)
    const id = nextId()
    await write({ chat, message: { id, role: 'assistant', parts: [{ type: 'text', text }], ...chat.row?.channel !== 'web' && { metadata: { delivery: 'pending' } } } })
    return id
  },

  answer: async ({ threadId }: { threadId: string }): Promise<string> => reply({ chat: await chatOf(threadId) }),

  inboundId: ({ at, ref }: { at: Date; ref: string }): string => idAt({ ms: at.getTime(), tail: ref }),

  async archive({ actor, id, archived }: { actor: Caller; id: string; archived: boolean }): Promise<Thread> {
    const chat = await chatOf(id)
    await runner({ actor, id: chat.agent.id })
    if (!chat.row) throw new HttpError(400, 'The agent\'s main chat can\'t be archived.')
    await db.updateTable('chat_thread').set({ archived_at: archived ? new Date() : null }).where('id', '=', id).execute()
    emit({ name: 'thread.updated', actor, target: { type: 'thread', id, agentId: chat.agent.id } })
    const fresh = await chatOf(id)
    return threadOf({ chat: fresh, said: await saidOf(fresh), waiting: await waitingOn() })
  },

  async threadOfOrigin({ agentId, origin }: { agentId: string; origin: { platform: string; chat_id: string } }): Promise<string | undefined> {
    return origin.platform === 'api_server' ? threadService.bySession({ agentId, session: origin.chat_id }) : undefined
  },

  async delete({ actor, id, uploads }: { actor: Caller; id: string; uploads: string[] }): Promise<Deleted<'thread'>> {
    const chat = await chatOf(id)
    const agent = await runner({ actor, id: chat.agent.id })
    const said = await saidOf(chat)
    for (const each of said) await recordsService.remove({ collection: 'message', workspace: workspaceOf(agent), id: each.id, queue: true })
    if (chat.row) await db.deleteFrom('chat_thread').where('id', '=', id).execute()
    cache.delete(id)
    emit({ name: 'thread.deleted', actor, target: { type: 'thread', id, agentId: agent.id } })
    const sent = said.flatMap((each) => filesOf(each.message)).map((file) => file.url)
    const names = [...new Set([...sent, ...uploads].flatMap((path) => uploadName(path) ?? []))]
    for (let start = 0; start < names.length; start += MAX_REMOVED) {
      await autonomous.content.remove(agent.id, names.slice(start, start + MAX_REMOVED).map((name) => ({ kind: 'upload', name })))
        .catch((err: unknown) => log.warn({ event: 'thread.uploads_kept', agent: agent.id, error: messageOf(err) }))
    }
    return deleted({ id, object: 'thread' })
  },

  async removeFile({ actor, id, path }: { actor: Caller; id: string; path: string }): Promise<Deleted<'file'>> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    const name = uploadName(path)
    if (!name) throw new HttpError(400, 'Only files you sent in a chat can be deleted here.', { param: 'path' })
    const removed = await autonomous.content.remove(id, [{ kind: 'upload', name }])
    if (!removed.length) throw new HttpError(404, 'That upload isn\'t in the agent\'s uploads folder. It may have been deleted already.', { param: 'path' })
    return deleted({ id: path, object: 'file' })
  },

  async lookUpFiles({ actor, id, paths }: { actor: Caller; id: string; paths: string[] }): Promise<HomeFile[]> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    const wanted = [...new Set(paths)].flatMap((path) => {
      const inside = fileInHome(path)
      return inside ? [{ path, inside }] : []
    })
    if (!wanted.length) return []
    const files = await autonomous.content.stat(id, wanted.map((each) => ({ kind: 'file', name: each.inside })))
    const sizes = new Map(files.map((file) => [file.ref.name, file.size]))
    return wanted.flatMap(({ path, inside }) => {
      const size = sizes.get(inside)
      return size === undefined ? [] : [{ object: 'file' as const, name: inside.slice(inside.lastIndexOf('/') + 1), path, size }]
    })
  },

  async upload({ actor, id, file, body }: { actor: Caller; id: string; file: UploadFile; body: unknown }): Promise<ChatFile> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Send the file\'s bytes as the request body, with Content-Type: application/octet-stream. Empty files can\'t be attached.')
    const path = (await autonomous.content.write({ id, ref: { kind: 'upload', name: safeFileName(file.name) }, body, by: 'person' })).name
    return { object: 'file', name: path.slice(path.lastIndexOf('/') + 1), path: `${AGENT_HOME}/${path}`, size: body.length, mediaType: file.type && MEDIA_TYPE.test(file.type) ? file.type : 'application/octet-stream' }
  },

  async download({ actor, id, path, reply }: { actor: Caller; id: string; path: string; reply: FastifyReply }): Promise<FastifyReply> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    const inside = fileInHome(path)
    if (!inside) throw new HttpError(400, 'Only files in the agent\'s own folder can be saved.', { param: 'path' })
    const body = await autonomous.content.read(id, { kind: 'file', name: inside })
    if (body === null) throw new HttpError(404, 'That file isn\'t in the agent\'s home folder. It may have been moved or deleted.', { param: 'path' })
    const name = inside.slice(inside.lastIndexOf('/') + 1)
    return reply.header('content-type', 'application/octet-stream').header('x-content-type-options', 'nosniff').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(body)
  },

  async chat({ actor, id, body, reply }: { actor: Caller; id: string; body: SendChat; reply: FastifyReply }): Promise<void> {
    const chat = await chatOf(id)
    if (chat.row && chat.row.channel !== 'web') throw new HttpError(409, `This thread is in ${LABELS[chat.row.channel] ?? chat.row.channel}. Reply there.`)
    const agent = await runner({ actor, id: chat.agent.id })
    const said = await nextSaid({ chat, stored: await saidOf(chat), body, author: actor.email })
    if (chat.row?.title === NEW_THREAD) await nameNewThread({ id: chat.id, said })
    if (agent.wanted !== 'running') throw new HttpError(409, `${agent.name} is stopped. Start it and try again.`)
    const closed = new AbortController()
    reply.raw.on('close', () => closed.abort())
    const turn = startTurn({ chat: { ...chat, agent }, web: true })
    turn.done.catch((err: unknown) => log.warn({ event: 'agent.chat_failed', agent: agent.id, error: messageOf(err) }))
    const stream = turns.subscribe({ thread: chat.id, id: turn.id, signal: closed.signal })
    reply.hijack()
    if (stream) pipeUIMessageStreamToResponse({ response: reply.raw, stream })
    else reply.raw.end()
  },

  recover: (): Promise<void> => turns.recover(async ({ thread, id, message }) => {
    const chat = await chatOf(thread)
    const waiting = unanswered(await saidOf(chat))
    if (!message.parts.length && !waiting.length) return
    const note = `Stopped: OpenHut restarted before ${chat.agent.name} finished. Ask again.`
    const parts = [...message.parts, { type: 'text', text: note }]
    const stored = z.safeParse(ChatMessage, { id, role: 'assistant', parts, metadata: { ...waiting.length && { answered: waiting[waiting.length - 1].id } } }).data
    if (stored) await write({ chat, message: stored })
  }),

  newMessageId: (): string => nextId(),

  async updateMetadata({ threadId, messageId, change }: { threadId: string; messageId: string; change: (metadata: Record<string, unknown>) => Record<string, unknown> }): Promise<void> {
    const chat = await chatOf(threadId)
    const found = (await saidOf(chat)).find((each) => each.id === messageId)
    if (!found) return
    const metadata = found.message.metadata && typeof found.message.metadata === 'object' ? found.message.metadata as Record<string, unknown> : {}
    const message = { ...found.message, metadata: change(metadata) }
    await recordsService.put({ collection: 'message', id: messageId, parent: chat.id, workspace: workspaceOf(chat.agent), value: { message, ...found.session && { session: found.session } } satisfies MessageValue, queue: true })
    cache.delete(chat.id)
    emit({ name: 'thread.updated', target: { type: 'thread', id: chat.id, agentId: chat.agent.id } })
  },

  async runRoutine({ agentId, threadId = agentId, text, metadata, messageId }: { agentId: string; threadId?: string; text: string; metadata?: Record<string, unknown>; messageId?: string }): Promise<string> {
    const chat = await chatOf(threadId)
    if (chat.agent.id !== agentId) throw new HttpError(404, MISSING)
    if (!chat.row) return reply({ chat, prompt: text })
    const last = (await saidOf(chat)).at(-1)?.message
    if (last?.role !== 'user' || textOf(last) !== text) await write({ chat, message: { id: messageId ?? nextId(), role: 'user', parts: [{ type: 'text', text }], metadata: { author: chat.row.title, ...metadata } } })
    return reply({ chat })
  },
}

async function reply({ chat, prompt }: { chat: Chat; prompt?: string }): Promise<string> {
  const turn = startTurn({ chat, prompt })
  await turn.done
  return turn.text()
}

function startTurn({ chat, prompt, web = false }: { chat: Chat; prompt?: string; web?: boolean }): { id: string; done: Promise<void>; text: () => string } {
  const agent = chat.agent
  const id = nextId()
  let answered: string | undefined
  let session: string | undefined
  let text = ''
  const run = async ({ signal, write: send }: TurnRun): Promise<void> => {
    const said = await saidOf(chat)
    const waiting = prompt ? [] : unanswered(said)
    if (!prompt && !waiting.length) return
    answered = waiting.at(-1)?.id
    session = sessionOf({ said, base: chat.id })
    const started = Date.now()
    const work = turnWork({ agent, started })
    const live = liveThreads.turn({ thread: chat.id, agentId: agent.id, turnId: id, answering: authorsOf(waiting) })
    const asked = prompt ? undefined : together({ asked: waiting.map((each) => each.message), shared: (!!chat.row && chat.row.channel !== 'web') || agent.shared || peopleOf(agent.people).length > 0 })
    let spoke = false
    const writer = { write: (chunk: UIMessageChunk) => {
      if (chunk.type === 'text-delta' || chunk.type === SPEC_DATA_PART_TYPE) spoke = true
      send(chunk)
    } }
    const attempt = async (retry: boolean) => {
      const current = session ?? chat.id
      const message = asked ? await seeded({ said, session: current, message: asked }) : { id, role: 'user' as const, parts: [{ type: 'text', text: prompt ?? '' }] }
      for await (const chunk of answerStream({ agent, session: current, message, signal, work, retry, live })) writer.write(chunk)
    }
    try {
      writer.write({ type: 'start', messageId: id })
      const failed = await attempt(true).catch(async (err: unknown) => {
        if (!(err instanceof LostTurn)) throw err
        log.warn({ event: 'agent.session_lost', agent: agent.id, session })
        session = `${chat.id}.${nextId()}`
        await attempt(false)
      }).then(() => undefined, (err: unknown) => err)
      const error = failed === undefined ? undefined : messageOf(failed)
      const done = work.done({ error: signal.aborted ? STOPPED : error })
      if (done) writer.write({ type: 'data-work', id: 'work', data: done })
      if (failed !== undefined && !done && !spoke && !signal.aborted) stopped({ writer, reason: error ?? '' })
      if (failed !== undefined && !signal.aborted) throw failed
      for (const part of await afterTurn({ agentId: agent.id, since: started })) writer.write(part)
      writer.write({ type: 'finish' })
    } finally {
      live.end()
      log.info({ event: 'agent.chat', agent: agent.id, ms: Date.now() - started, aborted: signal.aborted })
    }
  }
  const save = async ({ message, failed }: TurnEnd): Promise<void> => {
    if (failed && !web) return
    const answer = foldCard(message)
    text = textOf(answer)
    if (!answer.parts.some((part) => part.type !== 'step-start') || (!web && SILENT.test(text))) return
    const metadata = { ...!chat.row && !web && { wake: true }, ...answered && { answered }, ...chat.row && chat.row.channel !== 'web' && { delivery: 'pending' } }
    const stored = z.safeParse(ChatMessage, { ...answer, id, metadata }).data
    if (stored) await write({ chat, message: stored, session })
  }
  return { id, done: turns.start({ id, thread: chat.id, agentId: agent.id, run, save }), text: () => text }
}

function toLive({ live, chunk }: { live: LiveTurnHandle; chunk: UIMessageChunk }): void {
  if (chunk.type === 'text-delta') return live.replying()
  if (chunk.type !== 'data-work') return
  const calls = z.safeParse(Work, chunk.data).data?.calls ?? []
  const call = calls.findLast((each) => each.status === 'running') ?? calls.at(-1)
  if (call) live.step(call.status === 'running' ? call.label : call.past)
}

function authorsOf(asked: Said[]): string[] {
  return [...new Set(asked.flatMap((each) => z.safeParse(Authored, each.message).data?.metadata.author ?? []))]
}

function unanswered(said: Said[]): Said[] {
  const cut = said.reduce((max, each) => {
    if (each.message.role !== 'assistant') return max
    const at = z.safeParse(Answered, each.message).data?.metadata.answered ?? each.id
    return at > max ? at : max
  }, '')
  return said.filter((each) => each.message.role === 'user' && each.id > cut)
}

function deliveryOf(message: ChatMessage): unknown {
  return (message.metadata as { delivery?: unknown } | undefined)?.delivery
}

async function runner({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
  const agent = await agentService.requireUse({ actor, id })
  return agent
}

function saidOf({ id, agent }: Chat): Promise<Said[]> {
  const held = cache.get(id)
  if (held) return held
  const found = recordsService.list({ collection: 'message', workspace: workspaceOf(agent), parent: id }).then((rows) => rows.flatMap((row) => {
    const value = z.safeParse(MessageValue, row.value).data
    return value ? [{ id: row.id, by: row.by, message: { ...value.message, id: row.id }, session: value.session }] : []
  }).sort((a, b) => a.id < b.id ? -1 : 1))
  cache.set(id, found)
  found.catch(() => { if (cache.get(id) === found) cache.delete(id) })
  return found
}

async function write({ chat, message, session }: { chat: Chat; message: ChatMessage; session?: string }): Promise<void> {
  await recordsService.put({ collection: 'message', id: message.id, parent: chat.id, workspace: workspaceOf(chat.agent), value: { message, ...session && { session } } satisfies MessageValue, queue: true })
  cache.delete(chat.id)
  if (chat.row) await db.updateTable('chat_thread').set({ archived_at: null }).where('id', '=', chat.id).where('archived_at', 'is not', null).execute()
  emit({ name: 'thread.updated', target: { type: 'thread', id: chat.id, agentId: chat.agent.id } })
}

async function chatOf(id: string): Promise<Chat> {
  const row = id.startsWith('th_') ? await db.selectFrom('chat_thread').selectAll().where('id', '=', id).executeTakeFirst() : undefined
  if (id.startsWith('th_') && !row) throw new HttpError(404, MISSING)
  const agent = await findRow({ table: 'agent', id: row?.agent_id ?? id, missing: MISSING })
  return { id, agent, row }
}

async function waitingChanged(askId: string): Promise<void> {
  const ask = await db.selectFrom('ask').select(['agent_id', 'origin']).where('id', '=', askId).executeTakeFirst().catch(() => undefined)
  const id = ask && await threadService.threadOfOrigin({ agentId: ask.agent_id, origin: JSON.parse(ask.origin) as { platform: string; chat_id: string } }).catch(() => undefined)
  if (ask && id) emit({ name: 'thread.updated', target: { type: 'thread', id, agentId: ask.agent_id } })
}

async function waitingOn(): Promise<{ threads: Set<string>; calledAt: Map<string, number> }> {
  const [asked, hooks] = await Promise.all([
    db.selectFrom('ask').select(['agent_id', 'origin']).where('status', '=', 'open').execute(),
    db.selectFrom('inbox_source').select(['id', 'last_at']).where('kind', '=', 'webhook').execute(),
  ])
  const threads = new Set<string>()
  for (const ask of asked) {
    const id = await threadService.threadOfOrigin({ agentId: ask.agent_id, origin: JSON.parse(ask.origin) as { platform: string; chat_id: string } }).catch(() => undefined)
    if (id) threads.add(id)
  }
  return { threads, calledAt: new Map(hooks.map((hook) => [hook.id, hook.last_at ? new Date(hook.last_at).getTime() : 0])) }
}

function isWaiting({ id, said, waiting }: { id: string; said: Said[]; waiting: Awaited<ReturnType<typeof waitingOn>> }): boolean {
  if (waiting.threads.has(id)) return true
  return said.some((each, index) => each.message.parts.some((part) => {
    const card = z.safeParse(SetupPart, part).data
    if (!card || (waiting.calledAt.get(card.data.webhookId) ?? Infinity) > timeOf(each.id)) return false
    return !said.slice(index + 1).some((later) => later.message.role === 'user' && textOf(later.message).trim() === `Done: ${card.data.title}`)
  }))
}

async function nameNewThread({ id, said }: { id: string; said: Said[] }): Promise<void> {
  const first = said.find((each) => each.message.role === 'user')
  const title = first && textOf(first.message).split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 80)
  if (title) await db.updateTable('chat_thread').set({ title }).where('id', '=', id).execute()
}

function previewOf(said: Said[]): string {
  const last = said.findLast((each) => !isWake(each.message))
  return last ? textOf(last.message).replace(/\s+/g, ' ').trim().slice(0, 200) : ''
}

function textOf(message: UIMessage | ChatMessage): string {
  return replyText(message.parts)
}

function workspaceOf(agent: AgentRow): string {
  return agent.workspace ?? HOME
}

function nextId(): string {
  lastMs = Math.max(Date.now(), lastMs + 1)
  return idAt({ ms: lastMs, tail: randomBytes(6).toString('base64url') })
}

const idAt = ({ ms, tail }: { ms: number; tail: string }): string => `msg_${ms.toString(36).padStart(9, '0')}${tail}`

const timeOf = (id: string): number => parseInt(id.slice(4, 13), 36) || 0

const sessionOf = ({ said, base }: { said: Said[]; base: string }): string => said.findLast((each) => each.session === base || each.session?.startsWith(`${base}.`))?.session ?? base

const keyOf = (place: ThreadPlace): string => `${place.platform}:${place.chat_id}:${place.thread_id ?? ''}`

const LABELS: Record<string, string> = { web: 'OpenHut', discord: 'Discord', slack: 'Slack', telegram: 'Telegram', whatsapp: 'WhatsApp' }

async function seeded({ said, session, message }: { said: Said[]; session: string; message: ChatMessage }): Promise<ChatMessage> {
  const me = HERE
  const asked = said.findLastIndex((each) => each.message.role !== 'user') + 1
  const known = said.findLastIndex((each) => each.by === me && each.session === session)
  const missed = said.slice(known + 1, asked).slice(-SEED)
  if (!missed.length) return message
  const lines = missed.map(({ message: each }) => {
    const text = each.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('').trim().slice(0, SEED_CHARS).replace(LABEL, '> ')
    const author = each.role === 'assistant' ? 'You' : z.safeParse(Authored, each).data?.metadata.author ?? 'They'
    return `${author}: ${text}`
  })
  return { ...message, parts: [{ type: 'text', text: `Earlier in this chat, before this computer ran you:\n\n${lines.join('\n\n')}\n\nNow:\n\n` }, ...message.parts] }
}

async function nextSaid({ chat, stored, body, author }: { chat: Chat; stored: Said[]; body: SendChat; author: string }): Promise<Said[]> {
  if (body.message) checkFiles(body.message)
  const trailing = body.trigger === 'regenerate-message' && stored.at(-1)?.message.role === 'assistant' ? stored.at(-1) : undefined
  const kept = trailing ? stored.slice(0, -1) : stored
  const asked = body.message && body.trigger === 'submit-message' ? authored({ message: { ...body.message, id: nextId(), role: 'user' }, author }) : undefined
  if (!asked && kept.at(-1)?.message.role !== 'user') throw new HttpError(400, 'Send a message first.', { param: 'message' })
  if (trailing) {
    await recordsService.remove({ collection: 'message', workspace: workspaceOf(chat.agent), id: trailing.id, queue: true })
    cache.delete(chat.id)
  }
  if (!asked) return kept
  await write({ chat, message: asked })
  return [...kept, { id: asked.id, by: HERE, message: asked }]
}

function authored({ message, author }: { message: ChatMessage; author: string }): ChatMessage {
  const { metadata: _, ...rest } = message
  return { ...rest, metadata: { author } }
}

function together({ asked, shared }: { asked: ChatMessage[]; shared: boolean }): ChatMessage {
  const last = asked[asked.length - 1]
  if (asked.length < 2 && !shared) return last
  return { ...last, parts: asked.flatMap((message, index) => {
    const author = z.safeParse(Authored, message).data?.metadata.author
    const label = shared && author ? `${author} wrote:\n` : ''
    const parts = shared ? message.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? { ...part, text: part.text.replace(LABEL, '> ') } : part) : message.parts
    return [{ type: 'text', text: `${index ? '\n\n' : ''}${label}` }, ...parts]
  }) }
}

function answerStream({ live, ...input }: { agent: AgentRow; session: string; message: ChatMessage; signal: AbortSignal; work: TurnWork; retry?: boolean; live: LiveTurnHandle }): ReadableStream<UIMessageChunk> {
  const tapped = pipeJsonRender(relayed(input)).pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform: (chunk, controller) => {
      toLive({ live, chunk })
      controller.enqueue(chunk)
    },
  }))
  return joinText(tapped)
}

async function afterTurn({ agentId, since }: { agentId: string; since: number }): Promise<UIMessageChunk[]> {
  const parts = await Promise.all(plugins().map((plugin) => plugin.afterTurn?.({ agentId, since: new Date(since) })))
  return parts.flatMap((part) => part ? [part as UIMessageChunk] : [])
}

function relayed(input: { agent: AgentRow; session: string; message: ChatMessage; signal: AbortSignal; work: TurnWork; retry?: boolean }): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start: (controller) => {
      const writer = { write: (chunk: UIMessageChunk) => controller.enqueue(chunk) }
      return relay({ ...input, writer }).then((reason) => {
        if (reason) stopped({ writer, reason })
        controller.close()
      }, (err: unknown) => controller.error(err))
    },
  })
}

function stopped({ writer, reason }: { writer: { write: (chunk: UIMessageChunk) => void }; reason: string }): void {
  writer.write({ type: 'text-start', id: 'stopped' })
  writer.write({ type: 'text-delta', id: 'stopped', delta: reason })
  writer.write({ type: 'text-end', id: 'stopped' })
}

function joinText(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  let pending: Extract<UIMessageChunk, { type: 'text-delta' }> | undefined
  let timer: NodeJS.Timeout | undefined
  const flush = (controller: TransformStreamDefaultController<UIMessageChunk>) => {
    clearTimeout(timer)
    timer = undefined
    if (pending && controller.desiredSize !== null) controller.enqueue(pending)
    pending = undefined
  }
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform: (chunk, controller) => {
      if (chunk.type === 'text-delta' && pending?.id === chunk.id) {
        pending = { ...pending, delta: pending.delta + chunk.delta }
        return
      }
      flush(controller)
      if (chunk.type !== 'text-delta') return controller.enqueue(chunk)
      pending = chunk
      timer = setTimeout(() => flush(controller), TEXT_MS).unref()
    },
    flush,
  }))
}

function foldCard(message: UIMessage): UIMessage {
  const patches = message.parts.flatMap((part) => part.type === SPEC_DATA_PART_TYPE ? z.safeParse(SpecPatch, part.data).data ?? [] : [])
  if (!patches.length) return message
  const spec = { root: '', elements: {} }
  for (const { patch } of patches) applySpecPatch(spec, patch as JsonPatch)
  const first = message.parts.findIndex((part) => part.type === SPEC_DATA_PART_TYPE)
  return { ...message, parts: message.parts.flatMap((part, index) => {
    if (index === first) return [{ type: SPEC_DATA_PART_TYPE, data: { type: 'flat', spec } }]
    return part.type === SPEC_DATA_PART_TYPE ? [] : [part]
  }) }
}

async function relay({ agent, session, message, writer, signal, work, retry = false }: { agent: AgentRow; session: string; message: ChatMessage; writer: { write: (chunk: UIMessageChunk) => void }; signal: AbortSignal; work?: TurnWork; retry?: boolean }): Promise<string | undefined> {
  await apply.settled(agent.id)
  const asked = await openAiOf({ agentId: agent.id, message })
  let text = 0
  let open = false
  let finish: string | null | undefined
  let ended = false
  for await (const event of autonomous.chat({ agent, session, message: asked, system: CHAT_NOTE, signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]) })) {
    if (event.type === 'dropped') throw text || !retry ? new Error(dropped(agent.name)) : new LostTurn()
    if (event.type === 'error' && event.lost && !text) throw new LostTurn()
    if (event.type === 'error') throw new Error(modelFailure({ name: agent.name, message: event.message }))
    if (event.type === 'done') ({ finish, ended } = event)
    if (event.type === 'tool') {
      if (open) writer.write({ type: 'text-end', id: `t${text}` })
      if (open) writer.write({ type: STEP, data: {} })
      open = false
      const shown = await work?.tool(z.safeParse(ToolProgress, event.progress).data ?? {})
      if (shown) writer.write({ type: 'data-work', id: 'work', data: shown })
    }
    if (event.type !== 'text') continue
    if (!open) writer.write({ type: 'text-start', id: `t${++text}` })
    open = true
    writer.write({ type: 'text-delta', id: `t${text}`, delta: event.delta })
  }
  if (open) writer.write({ type: 'text-end', id: `t${text}` })
  if (text) return undefined
  if (finish === 'cancelled') return `Stopped: ${agent.name} was interrupted before it answered. Ask again.`
  if (!ended && !finish && retry && !signal.aborted) throw new LostTurn()
  if (!ended && !finish) return dropped(agent.name)
  return `Stopped: ${agent.name} ended its turn without an answer. Ask again.`
}

export class LostTurn extends Error {}


const dropped = (name: string): string => `Stopped: the connection to ${name} dropped before it answered. Ask again.`

function modelFailure({ name, message }: { name: string; message: string }): string {
  log.warn({ event: 'agent.chat_failed', agent: name, error: message.slice(0, 500) })
  if (/\b401\b|not logged in|sign-in|setup-token/i.test(message)) return `${name} isn't ready: its Claude seat isn't signed in. An owner or admin connects the seat in Admin, then try again.`
  if (/\b429\b|rate limit/i.test(message)) return `${name}'s model is rate limited right now. Try again in a few minutes.`
  return `${name}'s model failed: ${message.slice(0, 300)}`
}

function checkFiles(message: ChatMessage): void {
  const parts = message.parts.filter((part) => part.type === 'file')
  if (parts.length > MAX_FILES) throw new HttpError(400, `Attach at most ${MAX_FILES} files to one message.`, { param: 'message' })
  if (filesOf(message).length !== parts.length) throw new HttpError(400, `Each attached file must be uploaded to this chat first, so its path is in ${UPLOADS}.`, { param: 'message' })
}

function filesOf(message: ChatMessage): FilePart[] {
  return message.parts.flatMap((part) => {
    const file = z.safeParse(FilePart, part).data
    return file && uploadName(file.url) ? [file] : []
  })
}

async function openAiOf({ agentId, message }: { agentId: string; message: ChatMessage }): Promise<OpenAiMessage> {
  const text = message.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('').trim()
  const files = filesOf(message)
  if (!files.length) return { role: message.role, content: text }
  const listed = [text, `Attached files:\n${files.map((file) => `- ${file.url} (${file.mediaType})`).join('\n')}`].filter(Boolean).join('\n\n')
  const images = await imagesOf({ agentId, files })
  return { role: message.role, content: images.length ? [{ type: 'text', text: listed }, ...images] : listed }
}

async function imagesOf({ agentId, files }: { agentId: string; files: FilePart[] }): Promise<ImagePart[]> {
  const images: ImagePart[] = []
  let total = 0
  for (const file of files.filter((each) => IMAGE_TYPES.includes(each.mediaType))) {
    const bytes = await autonomous.content.read(agentId, { kind: 'file', name: fileInHome(file.url) ?? '' }).catch(() => null)
    const body = bytes?.toString('base64')
    const type = bytes && imageTypeOf(bytes.subarray(0, 12))
    if (!body || !type || body.length > MAX_IMAGE_BASE64 || total + body.length > MAX_IMAGES_BASE64) continue
    total += body.length
    images.push({ type: 'image_url', image_url: { url: `data:${type};base64,${body}` } })
  }
  return images
}

export function imageTypeOf(head: Buffer): string | undefined {
  if (head.subarray(0, 4).equals(PNG)) return 'image/png'
  if (head.subarray(0, 3).equals(JPEG)) return 'image/jpeg'
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

export function safeFileName(name: string): string {
  const cleaned = (name.split(/[/\\]/).pop() ?? '').normalize('NFC').replace(/[^\p{L}\p{N}._ ()+,=@-]+/gu, '-').replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}_(+,=@]+/u, '').trim()
  const chars = Array.from(cleaned || 'file')
  const dot = chars.lastIndexOf('.')
  const ext = dot > 0 && chars.length - dot <= 16 ? chars.slice(dot) : []
  const stem = ext.length ? chars.slice(0, dot) : chars
  while (stem.length > 1 && (stem.length + ext.length > MAX_NAME || Buffer.byteLength([...stem, ...ext].join('')) > MAX_NAME_BYTES)) stem.pop()
  return [...stem, ...ext].join('')
}

// The agent's own model calls (every model provider's upstream) and Telegram polling aren't tool use.
const PLUMBING = [...Object.values(providers).map((provider) => provider.upstream.name), 'telegram']

export function shownCall(tool: string) {
  return !PLUMBING.some((upstream) => tool.startsWith(`${upstream} `))
}


function withoutPlumbing(message: ChatMessage): ChatMessage {
  const parts = message.parts.flatMap((part) => {
    if (part.type !== 'data-calls' || !Array.isArray(part.data)) return [part]
    const data = (part.data as ChatCall[]).filter((call) => shownCall(call.tool))
    return data.length ? [{ ...part, data }] : []
  })
  return { ...message, parts }
}

function threadOf({ chat: { id, agent, row }, said, waiting }: { chat: Chat; said: Said[]; waiting: Awaited<ReturnType<typeof waitingOn>> }): Thread {
  const at = (each: string | undefined) => new Date(each ? timeOf(each) : row?.created_at ?? agent.created_at).toISOString()
  return {
    id, object: 'thread', agentId: agent.id, title: row?.title ?? agent.name, origin: row ? JSON.parse(row.origin) as ThreadOrigin : APP_ORIGIN, place: placeOf(row?.place), readOnly: !!row && row.channel !== 'web', continueUrl: (row?.place && (JSON.parse(row.place) as ThreadPlace).url) || null, waiting: isWaiting({ id, said, waiting }), activeTurn: turns.current(id), preview: previewOf(said), archivedAt: row?.archived_at ? new Date(row.archived_at).toISOString() : null,
    createdAt: at(said[0]?.id), updatedAt: at(said.findLast((each) => !isWake(each.message))?.id),
  }
}

function placeOf(stored: string | null | undefined): Place | null {
  if (!stored) return null
  const { url: _, ...place } = JSON.parse(stored) as ThreadPlace
  return place
}

const isWake = (message: ChatMessage): boolean => z.safeParse(Woken, message).success

type Said = { id: string; by: string; message: ChatMessage; session?: string }
export type ThreadPlace = Place & { url?: string }
type FilePart = z.infer<typeof FilePart>
type ImagePart = { type: 'image_url'; image_url: { url: string } }
type OpenAiMessage = { role: 'user' | 'assistant'; content: string | ({ type: 'text'; text: string } | ImagePart)[] }
type AgentRow = Selectable<Database['agent']>
type Chat = { id: string; agent: AgentRow; row?: Selectable<Database['chat_thread']> }
type TurnWork = ReturnType<typeof turnWork>

