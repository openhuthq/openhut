import type { FastifyReply } from 'fastify'
import type { Selectable } from 'kysely'
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessageStreamWriter } from 'ai'
import * as z from 'zod/mini'
import { ChatMessage, ToolProgress, type ChatCall, type SendChat, type Thread, type ThreadWithMessages } from '@fastmonkey/common/threads/thread.ts'
import type { Deleted } from '@fastmonkey/common/api.ts'
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
const TITLE_LENGTH = 80
const TURN_MS = 15 * 60_000
const StoredMessages = z.array(ChatMessage)
const Chunk = z.object({
  choices: z.optional(z.array(z.object({ delta: z.optional(z.object({ content: z.optional(z.nullable(z.string())) })) }))),
  error: z.optional(z.object({ message: z.string() })),
})

export const threadService = {
  async list({ actor }: { actor: Caller }): Promise<Thread[]> {
    const rows = await db.selectFrom('thread').selectAll().where('person_id', '=', actor.id).orderBy('updated_at', 'desc').limit(MAX_THREADS).execute()
    return rows.map(threadOf)
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<ThreadWithMessages> {
    const row = await ownRow({ actor, id })
    return { ...threadOf(row), messages: messagesOf(row) }
  },

  async create({ actor, agentId, title }: { actor: Caller; agentId: string; title: string }): Promise<Thread> {
    await agentService.requireEditable({ actor, id: agentId })
    const clean = title.replace(/\s+/g, ' ').trim()
    const row = await db.insertInto('thread').values({
      id: newId('th'), agent_id: agentId, person_id: actor.id, title: clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1)}…` : clean || 'New thread',
    }).returningAll().executeTakeFirstOrThrow()
    return threadOf(row)
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'thread'>> {
    await ownRow({ actor, id })
    await db.deleteFrom('thread').where('id', '=', id).execute()
    return deleted({ id, object: 'thread' })
  },

  async chat({ actor, id, body, reply }: { actor: Caller; id: string; body: SendChat; reply: FastifyReply }): Promise<void> {
    const row = await ownRow({ actor, id })
    const agent = await agentService.requireEditable({ actor, id: row.agent_id })
    if (agent.wanted !== 'running') throw new HttpError(409, `${agent.name} is stopped. Start it and try again.`)
    const messages = nextMessages({ stored: messagesOf(row), body })
    await save({ id, messages })
    const lastCall = await db.selectFrom('connection_event').select((eb) => eb.fn.max('id').as('id')).where('agent_id', '=', agent.id).executeTakeFirst()
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const started = Date.now()
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' })
        await relay({ agent, messages, writer, signal: abort.signal })
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

async function relay({ agent, messages, writer, signal }: { agent: AgentRow; messages: ChatMessage[]; writer: UIMessageStreamWriter; signal: AbortSignal }): Promise<void> {
  const res = await fetch(`${agentApiUrl(agent.net)}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${unseal(agent.channel_key)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: messages.map(openAiOf).filter((message) => message.content) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]),
  }).catch((err: unknown) => { throw new Error(signal.aborted ? 'Stopped.' : `${agent.name} isn't reachable. ${unreachable(err)}`) })
  if (!res.ok || !res.body) throw new Error(`${agent.name} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  let text = 0
  let open = false
  for await (const event of sseEvents(res.body)) {
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
  return messages
}

const dropTrailingAnswer = (messages: ChatMessage[]): ChatMessage[] => messages.at(-1)?.role === 'assistant' ? messages.slice(0, -1) : messages

function openAiOf(message: ChatMessage): { role: 'user' | 'assistant'; content: string } {
  const content = message.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('').trim()
  return { role: message.role, content }
}

async function callsSince({ agentId, after }: { agentId: string; after: string }): Promise<ChatCall[]> {
  const rows = await db.selectFrom('connection_event as e').leftJoin('connection as c', 'c.id', 'e.connection_id')
    .select(['e.tool', 'c.name', 'e.outcome', 'e.reason', 'e.ms']).where('e.agent_id', '=', agentId).where('e.id', '>', after).orderBy('e.id').limit(50).execute()
  return rows.map((row) => ({ tool: row.tool, connectionName: row.name, outcome: row.outcome, reason: row.reason, ms: row.ms }))
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

const messagesOf = (row: ThreadRow): ChatMessage[] => z.safeParse(StoredMessages, parseJson(row.messages)).data ?? []

function threadOf(row: ThreadRow): Thread {
  return { id: row.id, object: 'thread', agentId: row.agent_id, title: row.title, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}

type ThreadRow = Selectable<Database['thread']>
type AgentRow = Selectable<Database['agent']>
