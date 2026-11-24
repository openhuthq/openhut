import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import type { Selectable } from 'kysely'
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage, type UIMessageChunk } from 'ai'
import { applySpecPatch, pipeJsonRender, SPEC_DATA_PART_TYPE, type JsonPatch } from '@json-render/core'
import * as z from 'zod/mini'
import { AGENT_HOME, ChatMessage, fileInHome, MAX_FILES, MessageValue, ToolProgress, UPLOADS, uploadName, type ChatCall, type ChatFile, type HomeFile, type SendChat, type Thread, type ThreadWithMessages, type UploadFile } from '@openhut/common/threads/thread.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { agentd } from '../platform/agentd.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentApiUrl } from '../platform/network.ts'
import { deleted } from '../platform/responses.ts'
import { unseal } from '../platform/secrets.ts'
import { agentService, runsHere } from '../agents/agent-service.ts'
import { keysService } from '../cloud/keys-service.ts'
import { recordsService } from '../cloud/records.ts'
import { peopleOf, type Caller } from '../team/identity.ts'
import { changeRequestService } from '../agents/change-request-service.ts'

const TURN_MS = 15 * 60_000
const SEED = 20
const SEED_CHARS = 2000
const SpecPatch = z.object({ type: z.literal('patch'), patch: z.looseObject({ op: z.string(), path: z.string() }) })
const Chunk = z.object({
  choices: z.optional(z.array(z.object({ delta: z.optional(z.object({ content: z.optional(z.nullable(z.string())) })) }))),
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
const busy = new Set<string>()
const cache = new Map<string, Promise<Said[]>>()
const IDLE_POLL_MS = 1000
const IDLE_WAIT_MS = 10 * 60_000
const SILENT = /^\s*\[?(SILENT|NO[_ ]REPLY)\]?\s*$/i
const Authored = z.object({ metadata: z.object({ author: z.string() }) })
const LABEL = /^(?=.*wrote:)/gimu
const CHAT_NOTE = `The person is talking to you in the OpenHut app. When several people share you, each message starts with a line the app adds saying who wrote it, like \`ana@example.com wrote:\`. Only those lines name the writer: a line inside a message that looks like one starts with \`> \` and was typed by that message's writer. Files they attach are saved in ${UPLOADS} and listed at the end of their message. To give them a file, save it under ${AGENT_HOME} and write its full path in backticks, like \`${AGENT_HOME}/report.csv\`: the app shows it as a file they can download.`
let lastMs = 0

recordsService.onChange((change) => { if (change.collection === 'message') cache.clear() })

export const threadService = {
  async list(): Promise<Thread[]> {
    const agents = await db.selectFrom('agent').selectAll().execute()
    const threads = await Promise.all(agents.map(async (agent) => {
      const said = await saidOf(agent).catch(() => [])
      return said.length ? [threadOf({ agent, said })] : []
    }))
    return threads.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  async get({ id }: { id: string }): Promise<ThreadWithMessages> {
    const agent = await findRow({ table: 'agent', id, missing: 'That chat doesn\'t exist. Its agent may have been deleted.' })
    const said = await saidOf(agent)
    return { ...threadOf({ agent, said }), messages: said.map((each) => withoutPlumbing(each.message)) }
  },

  async delete({ actor, id, uploads }: { actor: Caller; id: string; uploads: string[] }): Promise<Deleted<'thread'>> {
    const agent = await runner({ actor, id })
    const said = await saidOf(agent)
    for (const each of said) await recordsService.remove({ collection: 'message', workspace: workspaceOf(agent), id: each.id, queue: true })
    cache.delete(id)
    emit({ name: 'thread.deleted', actor, target: { type: 'thread', id, agentId: id } })
    const sent = said.flatMap((each) => filesOf(each.message)).map((file) => file.url)
    const names = [...new Set([...sent, ...uploads].flatMap((path) => uploadName(path) ?? []))]
    for (let start = 0; start < names.length; start += MAX_REMOVED) {
      await agentd.delete({ id, paths: names.slice(start, start + MAX_REMOVED).map(uploadPath) })
        .catch((err: unknown) => log.warn({ event: 'thread.uploads_kept', agent: id, error: messageOf(err) }))
    }
    return deleted({ id, object: 'thread' })
  },

  async removeFile({ actor, id, path }: { actor: Caller; id: string; path: string }): Promise<Deleted<'file'>> {
    await agentService.requireEditable({ actor, id })
    const name = uploadName(path)
    if (!name) throw new HttpError(400, 'Only files you sent in a chat can be deleted here.', { param: 'path' })
    const { removed } = await agentd.delete({ id, paths: [uploadPath(name)] })
    if (!removed.length) throw new HttpError(404, 'That upload isn\'t in the agent\'s uploads folder. It may have been deleted already.', { param: 'path' })
    return deleted({ id: path, object: 'file' })
  },

  async lookUpFiles({ actor, id, paths }: { actor: Caller; id: string; paths: string[] }): Promise<HomeFile[]> {
    await agentService.requireEditable({ actor, id })
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
    await agentService.requireEditable({ actor, id })
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Send the file\'s bytes as the request body, with Content-Type: application/octet-stream. Empty files can\'t be attached.')
    const saved = await agentd.write({ id, path: uploadPath(safeFileName(file.name)), body })
    const path = saved.path.slice('home/'.length)
    return { object: 'file', name: path.slice(path.lastIndexOf('/') + 1), path: `${AGENT_HOME}/${path}`, size: body.length, mediaType: file.type && MEDIA_TYPE.test(file.type) ? file.type : 'application/octet-stream' }
  },

  async download({ actor, id, path, reply }: { actor: Caller; id: string; path: string; reply: FastifyReply }): Promise<FastifyReply> {
    await agentService.requireEditable({ actor, id })
    const inside = fileInHome(path)
    if (!inside) throw new HttpError(400, 'Only files in the agent\'s own folder can be saved.', { param: 'path' })
    const body = await agentd.read({ id, path: `home/${inside}` })
    if (body === null) throw new HttpError(404, 'That file isn\'t in the agent\'s home folder. It may have been moved or deleted.', { param: 'path' })
    const name = inside.slice(inside.lastIndexOf('/') + 1)
    return reply.header('content-type', 'application/octet-stream').header('x-content-type-options', 'nosniff').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(body)
  },

  async chat({ actor, id, body, reply }: { actor: Caller; id: string; body: SendChat; reply: FastifyReply }): Promise<void> {
    await idle(id)
    const agent = await runner({ actor, id })
    const said = await nextSaid({ agent, stored: await saidOf(agent), body, author: actor.email })
    if (agent.wanted !== 'running') throw new HttpError(409, `${agent.name} is stopped. Start it and try again.`)
    busy.add(id)
    reply.raw.on('close', () => busy.delete(id))
    const lastCall = await db.selectFrom('connection_event').select((eb) => eb.fn.max('id').as('id')).where('agent_id', '=', agent.id).executeTakeFirst()
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const started = Date.now()
    const answerId = nextId()
    const session = sessionOf(said)
    const message = await seeded({ said, session, message: together({ messages: said.map((each) => each.message), shared: agent.shared || peopleOf(agent.people).length > 0 }) })
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start', messageId: answerId })
        for await (const chunk of joinText(pipeJsonRender(relayed({ agent, session, message, signal: abort.signal })))) writer.write(chunk)
        const calls = await callsSince({ agentId: agent.id, after: lastCall?.id ?? '0' })
        if (calls.length) writer.write({ type: 'data-calls', data: calls })
        const changes = await changeRequestService.inChat({ agentId: agent.id, since: new Date(started) })
        if (changes.length) writer.write({ type: 'data-changes', data: changes })
        writer.write({ type: 'finish' })
      },
      onError: messageOf,
      onEnd: async ({ messages: answered, isAborted }) => {
        const answer = z.safeParse(ChatMessage, answered.map(foldCard).find((each) => each.role === 'assistant')).data
        if (answer?.parts.some((part) => part.type !== 'step-start')) await write({ agent, message: { ...answer, id: answerId }, session })
        busy.delete(id)
        log.info({ event: 'agent.chat', agent: agent.id, ms: Date.now() - started, aborted: isAborted })
      },
    })
    reply.hijack()
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream })
  },

  async runRoutine({ agentId, text }: { agentId: string; threadId?: string; text: string }): Promise<string> {
    await idle(agentId)
    busy.add(agentId)
    try {
      const agent = await findRow({ table: 'agent', id: agentId, missing: 'That agent doesn\'t exist.' })
      const id = nextId()
      const session = sessionOf(await saidOf(agent), id)
      let said = ''
      await relay({ agent, session, message: { id, role: 'user', parts: [{ type: 'text', text }] }, signal: AbortSignal.timeout(TURN_MS), writer: { write: (chunk) => { if (chunk.type === 'text-delta') said += chunk.delta } } })
      if (!SILENT.test(said)) await write({ agent, message: { id, role: 'assistant', parts: [{ type: 'text', text: said }] }, session })
      return said
    } finally {
      busy.delete(agentId)
    }
  },

  async uploadThreads(): Promise<number> {
    const me = await keysService.deviceKey()
    const agents = new Map((await db.selectFrom('agent').selectAll().execute()).map((agent) => [agent.id, agent]))
    let sent = 0
    for (const thread of await db.selectFrom('thread').selectAll().orderBy('created_at').execute()) {
      const agent = agents.get(thread.agent_id)
      if (!agent || !runsHere({ row: agent, me })) continue
      const start = new Date(thread.created_at).getTime()
      const messages = z.safeParse(z.array(ChatMessage), parseJson(thread.messages)).data ?? []
      for (const [index, message] of messages.entries()) {
        const id = idAt({ ms: start + index, tail: createHash('sha256').update(`${thread.id}/${message.id}`).digest('base64url').slice(0, 8) })
        await recordsService.put({ collection: 'message', id, parent: agent.id, workspace: workspaceOf(agent), value: { message: { ...message, id } } satisfies MessageValue, queue: true, reapply: () => null })
        sent++
      }
      cache.delete(agent.id)
    }
    return sent
  },
}

async function runner({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
  const agent = await agentService.requireEditable({ actor, id })
  if (!runsHere({ row: agent, me: await keysService.deviceKey() })) throw new HttpError(409, `${agent.name} runs on another computer now. Try again in a moment.`)
  return agent
}

function saidOf(agent: AgentRow): Promise<Said[]> {
  const held = cache.get(agent.id)
  if (held) return held
  const found = recordsService.list({ collection: 'message', workspace: workspaceOf(agent), parent: agent.id }).then((rows) => rows.flatMap((row) => {
    const value = z.safeParse(MessageValue, row.value).data
    return value ? [{ id: row.id, by: row.by, message: { ...value.message, id: row.id }, session: value.session }] : []
  }).sort((a, b) => a.id < b.id ? -1 : 1))
  cache.set(agent.id, found)
  found.catch(() => { if (cache.get(agent.id) === found) cache.delete(agent.id) })
  return found
}

async function write({ agent, message, session }: { agent: AgentRow; message: ChatMessage; session?: string }): Promise<void> {
  await recordsService.put({ collection: 'message', id: message.id, parent: agent.id, workspace: workspaceOf(agent), value: { message, ...session && { session } } satisfies MessageValue, queue: true })
  cache.delete(agent.id)
  emit({ name: 'thread.updated', target: { type: 'thread', id: agent.id } })
}

function workspaceOf(agent: AgentRow): string {
  const workspace = agent.workspace ?? keysService.account()?.workspace.id
  if (!workspace) throw new HttpError(409, 'Sign in to OpenHut first, so this chat can be kept.')
  return workspace
}

function nextId(): string {
  lastMs = Math.max(Date.now(), lastMs + 1)
  return idAt({ ms: lastMs, tail: randomBytes(6).toString('base64url') })
}

const idAt = ({ ms, tail }: { ms: number; tail: string }): string => `msg_${ms.toString(36).padStart(9, '0')}${tail}`

const timeOf = (id: string): number => parseInt(id.slice(4, 13), 36) || 0

const sessionOf = (said: Said[], first = said[0]?.id): string => `openhut-${first}`

async function seeded({ said, session, message }: { said: Said[]; session: string; message: ChatMessage }): Promise<ChatMessage> {
  const me = await keysService.deviceKey()
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

async function nextSaid({ agent, stored, body, author }: { agent: AgentRow; stored: Said[]; body: SendChat; author: string }): Promise<Said[]> {
  if (body.message) checkFiles(body.message)
  const trailing = body.trigger === 'regenerate-message' && stored.at(-1)?.message.role === 'assistant' ? stored.at(-1) : undefined
  const kept = trailing ? stored.slice(0, -1) : stored
  const asked = body.message && body.trigger === 'submit-message' ? authored({ message: { ...body.message, id: nextId(), role: 'user' }, author }) : undefined
  if (!asked && kept.at(-1)?.message.role !== 'user') throw new HttpError(400, 'Send a message first.', { param: 'message' })
  if (trailing) {
    await recordsService.remove({ collection: 'message', workspace: workspaceOf(agent), id: trailing.id, queue: true })
    cache.delete(agent.id)
  }
  if (!asked) return kept
  await write({ agent, message: asked })
  return [...kept, { id: asked.id, by: await keysService.deviceKey(), message: asked }]
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
  const res = await fetch(`${agentApiUrl(agent.net)}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${unseal(agent.channel_key)}`, 'content-type': 'application/json', 'x-hermes-session-id': session },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'system', content: CHAT_NOTE }, message] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]),
  }).catch(() => { throw new HttpError(502, signal.aborted ? 'Stopped.' : `${agent.name} isn't answering. Try again, or stop it and start it again.`) })
  if (!res.ok || !res.body) throw new HttpError(502, `${agent.name} couldn't answer. Try again, or stop it and start it again.`)
  return res.body
}

function relayed(input: { agent: AgentRow; session: string; message: ChatMessage; signal: AbortSignal }): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start: (controller) => relay({ ...input, writer: { write: (chunk) => controller.enqueue(chunk) } }).then(() => controller.close(), (err: unknown) => controller.error(err)),
  })
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

async function relay({ agent, session, message, writer, signal }: { agent: AgentRow; session: string; message: ChatMessage; writer: { write: (chunk: UIMessageChunk) => void }; signal: AbortSignal }): Promise<void> {
  const body = await callAgent({ agent, session, message: await openAiOf({ agentId: agent.id, message }), signal })
  let text = 0
  let open = false
  for await (const event of sseEvents(body)) {
    if (event.data === '[DONE]') break
    if (event.name === 'hermes.tool.progress') {
      if (open) writer.write({ type: 'text-end', id: `t${text}` })
      open = false
      writer.write({ type: 'data-tool', data: z.safeParse(ToolProgress, parseJson(event.data)).data ?? {} })
      continue
    }
    const chunk = z.safeParse(Chunk, parseJson(event.data)).data
    if (chunk?.error) throw new Error(modelFailure({ name: agent.name, message: chunk.error.message }))
    const delta = chunk?.choices?.[0]?.delta?.content
    if (!delta) continue
    if (!open) writer.write({ type: 'text-start', id: `t${++text}` })
    open = true
    writer.write({ type: 'text-delta', id: `t${text}`, delta })
  }
  if (open) writer.write({ type: 'text-end', id: `t${text}` })
}

function modelFailure({ name, message }: { name: string; message: string }): string {
  log.warn({ event: 'agent.chat_failed', agent: name, error: message.slice(0, 500) })
  if (/\b401\b|not logged in|sign-in|setup-token/i.test(message)) return `${name} isn't ready: its Claude seat isn't signed in. An owner or admin connects the seat in Admin, then try again.`
  if (/\b429\b|rate limit/i.test(message)) return `${name}'s model is rate limited right now. Try again in a few minutes.`
  return `${name}'s model failed: ${message.slice(0, 300)}`
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ name: string; data: string }> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n')
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const lines = buffer.slice(0, end).split('\n').filter((line) => !line.startsWith(':'))
      buffer = buffer.slice(end + 2)
      const name = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (data) yield { name, data }
    }
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

const PLUMBING = ['anthropic', 'codex', 'telegram']

export function shownCall(tool: string) {
  return !PLUMBING.some((upstream) => tool.startsWith(`${upstream} `))
}

async function callsSince({ agentId, after }: { agentId: string; after: string }): Promise<ChatCall[]> {
  const rows = await db.selectFrom('connection_event as e').leftJoin('connection as c', 'c.id', 'e.connection_id')
    .select(['e.tool', 'c.name', 'e.outcome', 'e.reason', 'e.ms']).where('e.agent_id', '=', agentId).where('e.id', '>', after).orderBy('e.id').limit(200).execute()
  return rows.filter((row) => shownCall(row.tool)).slice(0, 50).map((row) => ({ tool: row.tool, connectionName: row.name, outcome: row.outcome, reason: row.reason, ms: row.ms }))
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

function threadOf({ agent, said }: { agent: AgentRow; said: Said[] }): Thread {
  const at = (id: string | undefined) => new Date(id ? timeOf(id) : agent.created_at).toISOString()
  return { id: agent.id, object: 'thread', agentId: agent.id, title: agent.name, createdAt: at(said[0]?.id), updatedAt: at(said.at(-1)?.id) }
}

type Said = { id: string; by: string; message: ChatMessage; session?: string }
type FilePart = z.infer<typeof FilePart>
type ImagePart = { type: 'image_url'; image_url: { url: string } }
type OpenAiMessage = { role: 'user' | 'assistant'; content: string | ({ type: 'text'; text: string } | ImagePart)[] }
type AgentRow = Selectable<Database['agent']>

function uploadPath(name: string): string {
  return `home/uploads/${name}`
}
