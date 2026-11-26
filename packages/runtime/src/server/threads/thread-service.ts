import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import type { Selectable } from 'kysely'
import { createUIMessageStream, pipeUIMessageStreamToResponse, readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { applySpecPatch, pipeJsonRender, SPEC_DATA_PART_TYPE, type JsonPatch } from '@json-render/core'
import * as z from 'zod/mini'
import { AGENT_HOME, ChatMessage, fileInHome, MAX_FILES, MessageValue, ToolProgress, UPLOADS, uploadName, Work, type ChatCall, type ChatFile, type HomeFile, type SendChat, type Thread, type ThreadOrigin, type ThreadWithMessages, type UploadFile } from '@openhut/common/threads/thread.ts'
import type { Place } from '@openhut/common/channels/channel.ts'
import type { ThreadLive } from '@openhut/common/live.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { agentd } from '../platform/agentd.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, listen, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { forward } from '../relay/forward.ts'
import { config } from '../platform/config.ts'
import { deleted } from '../platform/responses.ts'
import { unseal } from '../platform/secrets.ts'
import { agentService } from '../agents/agent-service.ts'
import { HERE, HOME } from '../team/home.ts'
import { newId } from '../platform/secrets.ts'
import { channelService } from '../channels/channel-service.ts'
import { publicAddress } from '../platform/address.ts'
import { recordsService } from '../platform/records.ts'
import { peopleOf, type Caller } from '../team/identity.ts'
import { plugins } from '../../core/plugins.ts'
import { providers } from '../models/providers/index.ts'
import { turnWork } from './work.ts'
import { liveThreads, type LiveTurnHandle } from './live.ts'

const TURN_MS = 15 * 60_000
const SEED = 20
const SEED_CHARS = 2000
const SpecPatch = z.object({ type: z.literal('patch'), patch: z.looseObject({ op: z.string(), path: z.string() }) })
const Chunk = z.object({
  choices: z.optional(z.array(z.object({ delta: z.optional(z.object({ content: z.optional(z.nullable(z.string())) })), finish_reason: z.optional(z.nullable(z.string())) }))),
  error: z.optional(z.object({ message: z.string() })),
})
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
export const busy = new Set<string>()
const cache = new Map<string, Promise<Said[]>>()
const IDLE_POLL_MS = 1000
const IDLE_WAIT_MS = 10 * 60_000
const STARTING_STATUS = [502, 503, 504]
const SILENT = /^\s*\[?(SILENT|NO[_ ]REPLY)\]?\s*$/i
const Authored = z.object({ metadata: z.object({ author: z.string() }) })
const Woken = z.object({ metadata: z.object({ wake: z.literal(true) }) })
const LABEL = /^(?=.*wrote:)/gimu
const APP_ORIGIN: ThreadOrigin = { platform: 'app', label: 'OpenHut' }
const MISSING = 'That chat doesn\'t exist. It or its agent may have been deleted.'
const SESSION_FIRST = /^openhut-(msg_[\w-]+)/
const PAUSE_AFTER = 3
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
      return said.length ? [threadOf({ chat, said, waiting })] : []
    }))
    return threads.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  async get({ id }: { id: string }): Promise<ThreadWithMessages> {
    const chat = await chatOf(id)
    const said = await saidOf(chat)
    return { ...threadOf({ chat, said, waiting: await waitingOn() }), messages: said.map((each) => withoutPlumbing(each.message)) }
  },

  async live({ actor, id }: { actor: Caller; id: string }): Promise<ThreadLive> {
    await agentService.requireVisible({ actor, id: await threadService.agentIdOf(id) })
    return liveThreads.catchUp(id)
  },

  agentIdOf: async (id: string): Promise<string> => (await chatOf(id)).agent.id,

  async open({ agentId, key, title, origin, mirrors }: { agentId: string; key?: string; title: string; origin: ThreadOrigin; mirrors: Place[] }): Promise<string> {
    const found = () => db.selectFrom('chat_thread').select('id').where('agent_id', '=', agentId).where('key', '=', key ?? '').executeTakeFirst()
    const held = key ? await found() : undefined
    if (held) return held.id
    const made = await db.insertInto('chat_thread').values({ id: newId('th'), agent_id: agentId, key: key ?? null, title: title.slice(0, 120), origin: JSON.stringify(origin), mirrors: JSON.stringify(mirrors) })
      .onConflict((conflict) => conflict.columns(['agent_id', 'key']).doNothing()).returning('id').executeTakeFirst()
    const id = made?.id ?? (await found())?.id
    if (!id) throw new HttpError(500, 'The chat couldn\'t be saved. Try again.')
    emit({ name: 'thread.created', target: { type: 'thread', id, agentId, platform: origin.platform } })
    return id
  },

  async bySession({ agentId, session }: { agentId: string; session: string }): Promise<string> {
    const first = SESSION_FIRST.exec(session)?.[1]
    if (!first) return agentId
    const agent = await db.selectFrom('agent').select('workspace').where('id', '=', agentId).executeTakeFirst()
    const id = agent ? (await recordsService.get({ collection: 'message', workspace: agent.workspace ?? HOME, id: first }))?.parent : undefined
    return id && (id === agentId || (await db.selectFrom('chat_thread').select('id').where('id', '=', id).where('agent_id', '=', agentId).executeTakeFirst())) ? id : agentId
  },

  async recordTurn({ agentId, origin, user, author, reply }: { agentId: string; origin: Place; user: string; author: string; reply: string }): Promise<{ object: 'thread'; id: string }> {
    const id = await threadService.discordThread({ agentId, place: origin })
    await db.updateTable('chat_thread').set({ mirror_paused: false, web_streak: 0 }).where('id', '=', id).execute()
    const chat = await chatOf(id)
    if (user.trim()) await write({ chat, message: { id: nextId(), role: 'user', parts: [{ type: 'text', text: user }], metadata: { author } } })
    if (reply.trim() && !SILENT.test(reply)) await write({ chat, message: { id: nextId(), role: 'assistant', parts: [{ type: 'text', text: reply }] } })
    return { object: 'thread', id }
  },

  async mirror({ actor, id, paused }: { actor: Caller; id: string; paused: boolean }): Promise<Thread> {
    const chat = await chatOf(id)
    await runner({ actor, id: chat.agent.id })
    if (!chat.row) throw new HttpError(400, 'This chat isn\'t posted anywhere else.')
    await db.updateTable('chat_thread').set({ mirror_paused: paused, web_streak: 0 }).where('id', '=', id).execute()
    emit({ name: 'thread.updated', actor, target: { type: 'thread', id, agentId: chat.agent.id } })
    const fresh = await chatOf(id)
    return threadOf({ chat: fresh, said: await saidOf(fresh), waiting: await waitingOn() })
  },

  async archive({ actor, id, archived }: { actor: Caller; id: string; archived: boolean }): Promise<Thread> {
    const chat = await chatOf(id)
    await runner({ actor, id: chat.agent.id })
    if (!chat.row) throw new HttpError(400, 'The agent\'s main chat can\'t be archived.')
    await db.updateTable('chat_thread').set({ archived_at: archived ? new Date() : null }).where('id', '=', id).execute()
    emit({ name: 'thread.updated', actor, target: { type: 'thread', id, agentId: chat.agent.id } })
    const fresh = await chatOf(id)
    return threadOf({ chat: fresh, said: await saidOf(fresh), waiting: await waitingOn() })
  },

  async threadOfOrigin({ agentId, origin }: { agentId: string; origin: { platform: string; chat_id: string; thread_id?: string | null; parent_chat_id?: string | null } }): Promise<string | undefined> {
    if (origin.platform === 'api_server') return threadService.bySession({ agentId, session: origin.chat_id })
    if (origin.platform !== 'discord') return undefined
    const place = discordPlace(origin)
    const row = await db.selectFrom('chat_thread').select('id').where('agent_id', '=', agentId).where('key', '=', `discord:${place.chat_id}:${place.thread_id ?? ''}`).executeTakeFirst()
    return row?.id
  },

  async startChannelThread({ id, place, text, title }: { id: string; place: Place; text: string; title: string }): Promise<void> {
    const chat = await chatOf(id)
    if (!chat.row || !text.trim() || SILENT.test(text)) return
    const sent = await channelService.send({ agentId: chat.agent.id, place, text, startThread: title.slice(0, 100) })
    const home = { ...place, ...sent.threadId && { thread_id: sent.threadId } }
    await db.updateTable('chat_thread').set({ key: `${place.platform}:${place.chat_id}:${home.thread_id ?? ''}`, mirrors: JSON.stringify([home]), continue_url: sent.url }).where('id', '=', id).execute()
    emit({ name: 'thread.updated', target: { type: 'thread', id, agentId: chat.agent.id } })
  },

  async contextFor({ agentId, origin }: { agentId: string; origin: { platform: string; chat_id: string; thread_id?: string | null; parent_chat_id?: string | null } }): Promise<{ object: 'thread_context'; context: string | null }> {
    const id = await threadService.threadOfOrigin({ agentId, origin })
    const chat = id ? await chatOf(id) : undefined
    if (!chat?.row?.continue_url) return { object: 'thread_context', context: null }
    const lines = (await saidOf(chat)).slice(-SEED).map(({ message }) => `${message.role === 'assistant' ? 'You' : 'OpenHut'}: ${textOf(message).trim().slice(0, SEED_CHARS)}`)
    return { object: 'thread_context', context: lines.length ? `This Discord thread continues "${chat.row.title}", which you handled in OpenHut. What happened there:\n\n${lines.join('\n\n')}` : null }
  },

  discordThread: ({ agentId, place }: { agentId: string; place: Place }): Promise<string> => threadService.open({
    agentId, key: `${place.platform}:${place.chat_id}:${place.thread_id ?? ''}`, title: place.chat_name || 'Discord', origin: { platform: 'discord', label: place.chat_name || 'Discord' }, mirrors: [place],
  }),

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
      await agentd.delete({ id: agent.id, paths: names.slice(start, start + MAX_REMOVED).map(uploadPath) })
        .catch((err: unknown) => log.warn({ event: 'thread.uploads_kept', agent: agent.id, error: messageOf(err) }))
    }
    return deleted({ id, object: 'thread' })
  },

  async removeFile({ actor, id, path }: { actor: Caller; id: string; path: string }): Promise<Deleted<'file'>> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    const name = uploadName(path)
    if (!name) throw new HttpError(400, 'Only files you sent in a chat can be deleted here.', { param: 'path' })
    const { removed } = await agentd.delete({ id, paths: [uploadPath(name)] })
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
    const { files } = await agentd.stat({ id, paths: wanted.map((each) => `home/${each.inside}`) })
    const sizes = new Map(files.map((file) => [file.path.slice('home/'.length), file.size]))
    return wanted.flatMap(({ path, inside }) => {
      const size = sizes.get(inside)
      return size === undefined ? [] : [{ object: 'file' as const, name: inside.slice(inside.lastIndexOf('/') + 1), path, size }]
    })
  },

  async upload({ actor, id, file, body }: { actor: Caller; id: string; file: UploadFile; body: unknown }): Promise<ChatFile> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Send the file\'s bytes as the request body, with Content-Type: application/octet-stream. Empty files can\'t be attached.')
    const saved = await agentd.write({ id, path: uploadPath(safeFileName(file.name)), body })
    const path = saved.path.slice('home/'.length)
    return { object: 'file', name: path.slice(path.lastIndexOf('/') + 1), path: `${AGENT_HOME}/${path}`, size: body.length, mediaType: file.type && MEDIA_TYPE.test(file.type) ? file.type : 'application/octet-stream' }
  },

  async download({ actor, id, path, reply }: { actor: Caller; id: string; path: string; reply: FastifyReply }): Promise<FastifyReply> {
    id = await threadService.agentIdOf(id)
    await agentService.requireUse({ actor, id })
    const inside = fileInHome(path)
    if (!inside) throw new HttpError(400, 'Only files in the agent\'s own folder can be saved.', { param: 'path' })
    const body = await agentd.read({ id, path: `home/${inside}` })
    if (body === null) throw new HttpError(404, 'That file isn\'t in the agent\'s home folder. It may have been moved or deleted.', { param: 'path' })
    const name = inside.slice(inside.lastIndexOf('/') + 1)
    return reply.header('content-type', 'application/octet-stream').header('x-content-type-options', 'nosniff').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(body)
  },

  async chat({ actor, id, body, reply }: { actor: Caller; id: string; body: SendChat; reply: FastifyReply }): Promise<void> {
    const chat = await chatOf(id)
    if (chat.row?.continue_url) throw new HttpError(409, `Continue this in ${(JSON.parse(chat.row.mirrors) as Place[])[0]?.chat_name || 'its channel'}.`)
    await idle(chat.agent.id)
    const agent = await runner({ actor, id: chat.agent.id })
    const said = await nextSaid({ chat, stored: await saidOf(chat), body, author: actor.email })
    if (body.trigger === 'submit-message' && said.at(-1)?.message.role === 'user') await mirrorAsked({ chat, author: actor.email, text: textOf(said[said.length - 1].message) })
    if (agent.wanted !== 'running') throw new HttpError(409, `${agent.name} is stopped. Start it and try again.`)
    busy.add(agent.id)
    reply.raw.on('close', () => busy.delete(agent.id))
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const started = Date.now()
    const answerId = nextId()
    let session = sessionOf(said)
    const work = turnWork({ agent, started })
    const asked = together({ messages: said.map((each) => each.message), shared: agent.shared || peopleOf(agent.people).length > 0 })
    let answered = false
    const live = liveThreads.turn({ thread: chat.id, turnId: answerId, answering: answering(said) })
    const answer = async (writer: { write: (chunk: UIMessageChunk) => void }, retry: boolean) => {
      const message = await seeded({ said, session, message: asked })
      for await (const chunk of answerStream({ agent, session, message, signal: abort.signal, work, retry, live })) {
        if (chunk.type === 'text-delta' || chunk.type === SPEC_DATA_PART_TYPE) answered = true
        writer.write(chunk)
      }
    }
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start', messageId: answerId })
        const failed = await answer(writer, true).catch(async (err: unknown) => {
          if (!(err instanceof LostTurn)) throw err
          // Hermes lost a turn of this session (its gateway was killed mid-turn, e.g. by an update) and
          // pauses the session for good; carry on in a fresh session, seeded with the chat so far.
          log.warn({ event: 'agent.session_lost', agent: agent.id, session })
          session = `${sessionOf([], said[0]?.id)}.${nextId()}`
          await answer(writer, false)
        }).then(() => undefined, (err: unknown) => err)
        const done = work.done({ error: failed === undefined ? undefined : messageOf(failed) })
        if (done) writer.write({ type: 'data-work', id: 'work', data: done })
        if (failed !== undefined && !done && !answered && !abort.signal.aborted) stopped({ writer, reason: messageOf(failed) })
        if (failed !== undefined) throw failed
        for (const part of await afterTurn({ agentId: agent.id, since: started })) writer.write(part)
        writer.write({ type: 'finish' })
      },
      onError: messageOf,
      onEnd: async ({ messages: answered, isAborted }) => {
        const answer = z.safeParse(ChatMessage, answered.map(foldCard).find((each) => each.role === 'assistant')).data
        if (answer?.parts.some((part) => part.type !== 'step-start')) {
          await write({ chat, message: { ...answer, id: answerId }, session })
          if (!isAborted) await afterAnswer({ chat, message: answer })
        }
        live.end()
        busy.delete(agent.id)
        log.info({ event: 'agent.chat', agent: agent.id, ms: Date.now() - started, aborted: isAborted })
      },
    })
    reply.hijack()
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream })
  },

  async runRoutine({ agentId, threadId = agentId, text, metadata }: { agentId: string; threadId?: string; text: string; metadata?: Record<string, unknown> }): Promise<string> {
    await idle(agentId)
    busy.add(agentId)
    let live: LiveTurnHandle | undefined
    try {
      const chat = await chatOf(threadId)
      if (chat.agent.id !== agentId) throw new HttpError(404, MISSING)
      const agent = chat.agent
      const last = (await saidOf(chat)).at(-1)?.message
      const retried = last?.role === 'user' && textOf(last) === text ? last : undefined
      const asked: ChatMessage | undefined = chat.row ? retried ?? { id: nextId(), role: 'user', parts: [{ type: 'text', text }], metadata: { ...metadata, author: chat.row.title } } : undefined
      if (asked && !retried) await write({ chat, message: asked })
      const said = await saidOf(chat)
      const id = nextId()
      const session = sessionOf(said, asked ? undefined : id)
      const message = asked ? await seeded({ said, session, message: asked }) : { id, role: 'user' as const, parts: [{ type: 'text', text }] }
      const started = Date.now()
      const work = turnWork({ agent, started })
      const turn = liveThreads.turn({ thread: chat.id, turnId: id, answering: answering(said) })
      live = turn
      const chunks = async function* (): AsyncGenerator<UIMessageChunk> {
        yield* answerStream({ agent, session, message, signal: AbortSignal.timeout(TURN_MS), work, live: turn })
        const done = work.done({})
        if (done) yield { type: 'data-work', id: 'work', data: done }
        yield* await afterTurn({ agentId, since: started })
      }
      let built: UIMessage = { id, role: 'assistant', parts: [] }
      for await (const each of readUIMessageStream({ message: built, stream: ReadableStream.from(chunks()), terminateOnError: true })) built = each
      const answer = foldCard(built)
      const reply = textOf(answer)
      const stored = z.safeParse(ChatMessage, { ...answer, id, ...!chat.row && { metadata: { wake: true } } }).data
      if (stored && !SILENT.test(reply)) {
        await write({ chat, message: stored, session })
        await afterAnswer({ chat, message: stored })
      }
      return reply
    } finally {
      live?.end()
      busy.delete(agentId)
    }
  }
}

function toLive({ live, chunk }: { live: LiveTurnHandle; chunk: UIMessageChunk }): void {
  if (chunk.type === 'text-delta') return live.delta({ part: chunk.id, text: chunk.delta })
  if (chunk.type !== 'data-work') return
  const calls = z.safeParse(Work, chunk.data).data?.calls ?? []
  const call = calls.findLast((each) => each.status === 'running') ?? calls.at(-1)
  if (call) live.step(call.status === 'running' ? call.label : call.past)
}

function answering(said: Said[]): string[] {
  const asked = said.slice(said.findLastIndex((each) => each.message.role !== 'user') + 1)
  return [...new Set(asked.flatMap((each) => z.safeParse(Authored, each.message).data?.metadata.author ?? []))]
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

async function afterAnswer({ chat, message }: { chat: Chat; message: ChatMessage | UIMessage }): Promise<void> {
  const row = chat.row && await db.selectFrom('chat_thread').selectAll().where('id', '=', chat.id).executeTakeFirst()
  if (row) await mirror({ chat: { ...chat, row }, text: textOf(message) })
}

async function mirrorAsked({ chat, author, text }: { chat: Chat; author: string; text: string }): Promise<void> {
  if (!chat.row || chat.row.mirror_paused || chat.row.mirrors === '[]') return
  const row = await db.updateTable('chat_thread').set((eb) => ({ web_streak: eb('web_streak', '+', 1) })).where('id', '=', chat.id).returningAll().executeTakeFirstOrThrow()
  if (row.web_streak < PAUSE_AFTER) return mirror({ chat: { ...chat, row }, text: `${author} wrote in OpenHut:\n${text}` })
  await mirror({ chat: { ...chat, row }, text: `Continuing in OpenHut ↗ ${publicAddress()}/agents/${encodeURIComponent(chat.agent.id)}/threads/${encodeURIComponent(chat.id)}` })
  await db.updateTable('chat_thread').set({ mirror_paused: true }).where('id', '=', chat.id).execute()
  emit({ name: 'thread.updated', target: { type: 'thread', id: chat.id, agentId: chat.agent.id } })
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

async function mirror({ chat, text }: { chat: Chat; text: string }): Promise<void> {
  if (!chat.row || chat.row.mirror_paused || !text.trim()) return
  for (const place of JSON.parse(chat.row.mirrors) as Place[]) {
    await channelService.send({ agentId: chat.agent.id, place, text })
      .catch((err: unknown) => log.warn({ event: 'thread.mirror_failed', agent: chat.agent.id, thread: chat.id, platform: place.platform, error: messageOf(err) }))
  }
}

function textOf(message: UIMessage | ChatMessage): string {
  return message.parts.map((part) => part.type === 'text' && 'text' in part && typeof part.text === 'string' ? part.text : '').join('')
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

const sessionOf = (said: Said[], first = said[0]?.id): string => {
  const base = `openhut-${first}`
  return said.findLast((each) => each.session === base || each.session?.startsWith(`${base}.`))?.session ?? base
}

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

function together({ messages, shared }: { messages: ChatMessage[]; shared: boolean }): ChatMessage {
  const start = messages.findLastIndex((message) => message.role !== 'user') + 1
  const asked = messages.slice(start)
  const last = messages[messages.length - 1]
  if (asked.length < 2 && !shared) return last
  return { ...last, parts: asked.flatMap((message, index) => {
    const author = z.safeParse(Authored, message).data?.metadata.author
    const label = shared && author ? `${author} wrote:\n` : ''
    const parts = shared ? message.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? { ...part, text: part.text.replace(LABEL, '> ') } : part) : message.parts
    return [{ type: 'text', text: `${index ? '\n\n' : ''}${label}` }, ...parts]
  }) }
}

async function idle(id: string): Promise<void> {
  const until = Date.now() + IDLE_WAIT_MS
  while (busy.has(id) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
}

async function callAgent({ agent, session, message, signal }: { agent: AgentRow; session: string; message: OpenAiMessage; signal: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  const until = Date.now() + config.startWaitMs
  const ask = async (): Promise<Response> => {
    const res = await forward.fetch({ agent, path: '/v1/chat/completions', init: {
      method: 'POST',
      headers: { authorization: `Bearer ${unseal(agent.channel_key)}`, 'content-type': 'application/json', 'x-hermes-session-id': session },
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'system', content: CHAT_NOTE }, message] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]),
    } }).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))
    const starting = res instanceof Error || STARTING_STATUS.includes(res.status)
    if (!starting || signal.aborted || Date.now() > until) {
      if (res instanceof Error) throw res
      return res
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
    return ask()
  }
  const res = await ask().catch(() => { throw new HttpError(502, signal.aborted ? 'Stopped.' : `${agent.name} isn't answering. Try again, or stop it and start it again.`) })
  if (!res.ok || !res.body) throw new HttpError(502, `${agent.name} couldn't answer. Try again, or stop it and start it again.`)
  return res.body
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
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform: (chunk, controller) => {
      if (chunk.type === 'text-delta' && pending?.id === chunk.id) {
        pending = { ...pending, delta: pending.delta + chunk.delta }
        return
      }
      if (pending) controller.enqueue(pending)
      pending = chunk.type === 'text-delta' ? chunk : undefined
      if (!pending) controller.enqueue(chunk)
    },
    flush: (controller) => { if (pending) controller.enqueue(pending) },
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
  const body = await callAgent({ agent, session, message: await openAiOf({ agentId: agent.id, message }), signal })
  let text = 0
  let open = false
  let finish: string | null | undefined
  let ended = false
  const events = sseEvents({ body, signal, agentName: agent.name, retry })
  const next = () => events.next().catch((err: unknown) => { throw err instanceof LostTurn && text ? new Error(dropped(agent.name)) : err })
  try {
    for (let step = await next(); !step.done; step = await next()) {
      const event = step.value
      if (event.data === '[DONE]') {
        ended = true
        break
      }
      if (event.name === 'hermes.tool.progress') {
        if (open) writer.write({ type: 'text-end', id: `t${text}` })
        open = false
        const shown = await work?.tool(z.safeParse(ToolProgress, parseJson(event.data)).data ?? {})
        if (shown) writer.write({ type: 'data-work', id: 'work', data: shown })
        continue
      }
      const chunk = z.safeParse(Chunk, parseJson(event.data)).data
      if (chunk?.error?.message === 'unknown_execution' && !text) throw new LostTurn()
      if (chunk?.error) throw new Error(modelFailure({ name: agent.name, message: chunk.error.message }))
      finish = chunk?.choices?.[0]?.finish_reason ?? finish
      const delta = chunk?.choices?.[0]?.delta?.content
      if (!delta) continue
      if (!open) writer.write({ type: 'text-start', id: `t${++text}` })
      open = true
      writer.write({ type: 'text-delta', id: `t${text}`, delta })
    }
  } finally {
    await events.return(undefined)
  }
  if (open) writer.write({ type: 'text-end', id: `t${text}` })
  if (text) return undefined
  if (finish === 'cancelled') return `Stopped: ${agent.name} was interrupted before it answered. Ask again.`
  if (!ended && !finish && retry && !signal.aborted) throw new LostTurn()
  if (!ended && !finish) return dropped(agent.name)
  return `Stopped: ${agent.name} ended its turn without an answer. Ask again.`
}

export function discordPlace(origin: { chat_id: string; chat_name?: string | null; thread_id?: string | null; parent_chat_id?: string | null }): Place {
  const inThread = !!origin.thread_id && origin.thread_id === origin.chat_id && !!origin.parent_chat_id
  return {
    platform: 'discord',
    chat_id: inThread && origin.parent_chat_id ? origin.parent_chat_id : origin.chat_id,
    ...origin.thread_id && { thread_id: origin.thread_id },
    chat_name: origin.chat_name ?? '',
  }
}

class LostTurn extends Error {}

const dropped = (name: string): string => `Stopped: the connection to ${name} dropped before it answered. Ask again.`

function modelFailure({ name, message }: { name: string; message: string }): string {
  log.warn({ event: 'agent.chat_failed', agent: name, error: message.slice(0, 500) })
  if (/\b401\b|not logged in|sign-in|setup-token/i.test(message)) return `${name} isn't ready: its Claude seat isn't signed in. An owner or admin connects the seat in Admin, then try again.`
  if (/\b429\b|rate limit/i.test(message)) return `${name}'s model is rate limited right now. Try again in a few minutes.`
  return `${name}'s model failed: ${message.slice(0, 300)}`
}

async function* sseEvents({ body, signal, agentName, retry = false }: { body: ReadableStream<Uint8Array>; signal: AbortSignal; agentName: string; retry?: boolean }): AsyncGenerator<{ name: string; data: string }> {
  const decoder = new TextDecoder()
  let buffer = ''
  const reads = body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await reads.next().catch((err: unknown) => {
        if (signal.aborted) throw err
        throw retry ? new LostTurn() : new Error(dropped(agentName))
      })
      if (next.done) return
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n')
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const lines = buffer.slice(0, end).split('\n').filter((line) => !line.startsWith(':'))
        buffer = buffer.slice(end + 2)
        const name = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) yield { name, data }
      }
    }
  } finally {
    await reads.return?.().catch(() => undefined)
  }
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
    const bytes = await agentd.read({ id: agentId, path: `home/${fileInHome(file.url) ?? ''}` }).catch(() => null)
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

const parseJson = (text: string): unknown => { try { return JSON.parse(text) } catch { return undefined } }

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
    id, object: 'thread', agentId: agent.id, title: row?.title ?? agent.name, origin: row ? JSON.parse(row.origin) as ThreadOrigin : APP_ORIGIN, mirrors: row ? JSON.parse(row.mirrors) as Place[] : [], mirrorPaused: row?.mirror_paused ?? false, readOnly: !!row?.continue_url, continueUrl: row?.continue_url ?? null, waiting: isWaiting({ id, said, waiting }), archivedAt: row?.archived_at ? new Date(row.archived_at).toISOString() : null,
    createdAt: at(said[0]?.id), updatedAt: at(said.findLast((each) => !isWake(each.message))?.id),
  }
}

const isWake = (message: ChatMessage): boolean => z.safeParse(Woken, message).success

type Said = { id: string; by: string; message: ChatMessage; session?: string }
type FilePart = z.infer<typeof FilePart>
type ImagePart = { type: 'image_url'; image_url: { url: string } }
type OpenAiMessage = { role: 'user' | 'assistant'; content: string | ({ type: 'text'; text: string } | ImagePart)[] }
type AgentRow = Selectable<Database['agent']>
type Chat = { id: string; agent: AgentRow; row?: Selectable<Database['chat_thread']> }
type TurnWork = ReturnType<typeof turnWork>

function uploadPath(name: string): string {
  return `home/uploads/${name}`
}
