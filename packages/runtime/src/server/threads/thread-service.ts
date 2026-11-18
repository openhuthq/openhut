import type { FastifyReply } from 'fastify'
import type { Selectable } from 'kysely'
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageStreamWriter } from 'ai'
import * as z from 'zod/mini'
import { AGENT_HOME, ChatMessage, fileInHome, MAX_FILES, ToolProgress, UPLOADS, type ChatCall, type ChatFile, type SendChat, type Thread, type ThreadWithMessages, type UploadFile } from '@openhut/common/threads/thread.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { agentd } from '../platform/agentd.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentApiUrl } from '../platform/network.ts'
import { deleted } from '../platform/responses.ts'
import { newId, unseal } from '../platform/secrets.ts'
import { agentService, unreachable } from '../agents/agent-service.ts'
import type { Caller } from '../team/identity.ts'

const MAX_THREADS = 200
const TURN_MS = 15 * 60_000
const StoredMessages = z.array(ChatMessage)
const Chunk = z.object({
  choices: z.optional(z.array(z.object({ delta: z.optional(z.object({ content: z.optional(z.nullable(z.string())) })) }))),
  error: z.optional(z.object({ message: z.string() })),
})
const FilePart = z.object({ type: z.literal('file'), mediaType: z.string().check(z.maxLength(100)), filename: z.optional(z.string().check(z.maxLength(255))), url: z.string().check(z.maxLength(1024)) })
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BASE64 = 5_000_000
const MAX_IMAGES_BASE64 = 8_000_000
const MAX_NAME = 120
const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/
const CHAT_NOTE = `The person is talking to you in the OpenHut app. Files they attach are saved in ${UPLOADS} and listed at the end of their message. To give them a file, save it under ${AGENT_HOME} and write its full path in backticks, like \`${AGENT_HOME}/report.csv\`: the app shows it as a file they can download.`

export const threadService = {
  async list({ actor }: { actor: Caller }): Promise<Thread[]> {
    const rows = await db.selectFrom('thread').selectAll().where('person_id', '=', actor.id).orderBy('updated_at', 'desc').limit(MAX_THREADS).execute()
    return rows.map(threadOf)
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<ThreadWithMessages> {
    const row = await ownRow({ actor, id })
    return { ...threadOf(row), messages: messagesOf(row) }
  },

  async create({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Thread> {
    const agent = await agentService.requireEditable({ actor, id: agentId })
    const existing = await db.selectFrom('thread').selectAll().where('agent_id', '=', agentId).where('person_id', '=', actor.id).orderBy('created_at').executeTakeFirst()
    if (existing) return threadOf(existing)
    const row = await db.insertInto('thread').values({ id: newId('th'), agent_id: agentId, person_id: actor.id, title: agent.name }).returningAll().executeTakeFirstOrThrow()
    return threadOf(row)
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'thread'>> {
    await ownRow({ actor, id })
    await db.deleteFrom('thread').where('id', '=', id).execute()
    return deleted({ id, object: 'thread' })
  },

  async upload({ actor, id, file, body }: { actor: Caller; id: string; file: UploadFile; body: unknown }): Promise<ChatFile> {
    const row = await ownRow({ actor, id })
    await agentService.requireEditable({ actor, id: row.agent_id })
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Send the file\'s bytes as the request body, with Content-Type: application/octet-stream. Empty files can\'t be attached.')
    const { path } = await agentd.saveUpload({ id: row.agent_id, name: safeFileName(file.name), body })
    return { object: 'file', name: path.slice(path.lastIndexOf('/') + 1), path: `${AGENT_HOME}/${path}`, size: body.length, mediaType: file.type && MEDIA_TYPE.test(file.type) ? file.type : 'application/octet-stream' }
  },

  async download({ actor, id, path, reply }: { actor: Caller; id: string; path: string; reply: FastifyReply }): Promise<FastifyReply> {
    const row = await ownRow({ actor, id })
    await agentService.requireEditable({ actor, id: row.agent_id })
    const inside = fileInHome(path)
    if (!inside) throw new HttpError(400, `Only files in the agent's home folder, ${AGENT_HOME}, can be downloaded.`, { param: 'path' })
    const { body } = await agentd.readFile({ id: row.agent_id, path: inside })
    const name = inside.slice(inside.lastIndexOf('/') + 1)
    return reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(Buffer.from(body, 'base64'))
  },

  async chat({ actor, id, body, reply }: { actor: Caller; id: string; body: SendChat; reply: FastifyReply }): Promise<void> {
    const row = await ownRow({ actor, id })
    const agent = await agentService.requireEditable({ actor, id: row.agent_id })
    const messages = nextMessages({ stored: messagesOf(row), body })
    await save({ id, messages })
    if (agent.wanted !== 'running') throw new HttpError(409, `${agent.name} is stopped. Start it and try again.`)
    const lastCall = await db.selectFrom('connection_event').select((eb) => eb.fn.max('id').as('id')).where('agent_id', '=', agent.id).executeTakeFirst()
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const started = Date.now()
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' })
        await relay({ agent, session: `openhut-${id}`, message: messages[messages.length - 1], writer, signal: abort.signal })
        const calls = await callsSince({ agentId: agent.id, after: lastCall?.id ?? '0' })
        if (calls.length) writer.write({ type: 'data-calls', data: calls })
        writer.write({ type: 'finish' })
      },
      onError: messageOf,
      onEnd: async ({ messages: answered, isAborted }) => {
        await save({ id, messages: [...messages, ...(z.safeParse(StoredMessages, answered).data ?? [])] })
        log.info({ event: 'agent.chat', agent: agent.id, thread: id, ms: Date.now() - started, aborted: isAborted })
      },
    })
    reply.hijack()
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream })
  },
}

async function callAgent({ agent, session, message, signal }: { agent: AgentRow; session: string; message: OpenAiMessage; signal: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${agentApiUrl(agent.net)}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${unseal(agent.channel_key)}`, 'content-type': 'application/json', 'x-hermes-session-id': session },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'system', content: CHAT_NOTE }, message] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]),
  }).catch((err: unknown) => { throw new HttpError(502, signal.aborted ? 'Stopped.' : `${agent.name} isn't reachable. ${unreachable(err)}`) })
  if (!res.ok || !res.body) throw new HttpError(502, `${agent.name} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.body
}

async function relay({ agent, session, message, writer, signal }: { agent: AgentRow; session: string; message: ChatMessage; writer: UIMessageStreamWriter; signal: AbortSignal }): Promise<void> {
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

function nextMessages({ stored, body }: { stored: ChatMessage[]; body: SendChat }): ChatMessage[] {
  const kept = body.trigger === 'regenerate-message' ? dropTrailingAnswer(stored) : stored
  const messages = body.message && body.trigger === 'submit-message' ? [...kept.filter((message) => message.id !== body.message?.id), { ...body.message, role: 'user' as const }] : kept
  if (messages.at(-1)?.role !== 'user') throw new HttpError(400, 'Send a message first.', { param: 'message' })
  if (body.message) checkFiles(body.message)
  return messages
}

const dropTrailingAnswer = (messages: ChatMessage[]): ChatMessage[] => messages.at(-1)?.role === 'assistant' ? messages.slice(0, -1) : messages

function checkFiles(message: ChatMessage): void {
  const parts = message.parts.filter((part) => part.type === 'file')
  if (parts.length > MAX_FILES) throw new HttpError(400, `Attach at most ${MAX_FILES} files to one message.`, { param: 'message' })
  if (filesOf(message).length !== parts.length) throw new HttpError(400, `Each attached file must be uploaded to this chat first, so its path is in ${UPLOADS}.`, { param: 'message' })
}

function filesOf(message: ChatMessage): FilePart[] {
  return message.parts.flatMap((part) => {
    const file = z.safeParse(FilePart, part).data
    return file && file.url.startsWith(`${UPLOADS}/`) && fileInHome(file.url)?.split('/').length === 2 ? [file] : []
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
    const body = await agentd.readFile({ id: agentId, path: fileInHome(file.url) ?? '' }).then((reply) => reply.body, () => '')
    if (!body || body.length > MAX_IMAGE_BASE64 || total + body.length > MAX_IMAGES_BASE64) continue
    total += body.length
    images.push({ type: 'image_url', image_url: { url: `data:${file.mediaType};base64,${body}` } })
  }
  return images
}

export function safeFileName(name: string): string {
  const cleaned = (name.split(/[/\\]/).pop() ?? '').normalize('NFC').replace(/[^\p{L}\p{N}._ ()+,=@-]+/gu, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+/, '').trim()
  const chars = Array.from(cleaned || 'file')
  if (chars.length <= MAX_NAME) return chars.join('')
  const dot = chars.lastIndexOf('.')
  const ext = dot > 0 && chars.length - dot <= 16 ? chars.slice(dot) : []
  return [...chars.slice(0, MAX_NAME - ext.length), ...ext].join('')
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

async function save({ id, messages }: { id: string; messages: ChatMessage[] }): Promise<void> {
  await db.updateTable('thread').set({ messages: JSON.stringify(messages), updated_at: new Date() }).where('id', '=', id).execute()
}

async function ownRow({ actor, id }: { actor: Caller; id: string }): Promise<ThreadRow> {
  const row = await findRow({ table: 'thread', id, missing: 'That thread doesn\'t exist. It may have been deleted.' })
  if (row.person_id !== actor.id) throw new HttpError(404, 'That thread doesn\'t exist. It may have been deleted.')
  return row
}

const parseJson = (text: string): unknown => { try { return JSON.parse(text) } catch { return undefined } }

const messagesOf = (row: ThreadRow): ChatMessage[] => (z.safeParse(StoredMessages, parseJson(row.messages)).data ?? []).map(withoutPlumbing)

function withoutPlumbing(message: ChatMessage): ChatMessage {
  const parts = message.parts.flatMap((part) => {
    if (part.type !== 'data-calls' || !Array.isArray(part.data)) return [part]
    const data = (part.data as ChatCall[]).filter((call) => shownCall(call.tool))
    return data.length ? [{ ...part, data }] : []
  })
  return { ...message, parts }
}

function threadOf(row: ThreadRow): Thread {
  return { id: row.id, object: 'thread', agentId: row.agent_id, title: row.title, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}

type FilePart = z.infer<typeof FilePart>
type ImagePart = { type: 'image_url'; image_url: { url: string } }
type OpenAiMessage = { role: 'user' | 'assistant'; content: string | ({ type: 'text'; text: string } | ImagePart)[] }
type ThreadRow = Selectable<Database['thread']>
type AgentRow = Selectable<Database['agent']>
