import * as z from 'zod/mini'
import type { ChatEvent } from '../../core/agent.ts'
import { config } from '../../server/platform/config.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import { unseal } from '../../server/platform/secrets.ts'
import { forward } from '../../server/relay/forward.ts'

const STARTING_STATUS = [502, 503, 504]
const POLL_MS = 1000
const LOST = new Set(['unknown_execution', 'queue_full'])
const Chunk = z.object({
  choices: z.optional(z.array(z.object({ delta: z.optional(z.object({ content: z.optional(z.nullable(z.string())) })), finish_reason: z.optional(z.nullable(z.string())) }))),
  error: z.optional(z.object({ message: z.string() })),
})

export async function* chat({ agent, session, message, system, signal }: { agent: { id: string; name: string; net: number; channel_key: string }; session: string; message: object; system: string; signal: AbortSignal }): AsyncGenerator<ChatEvent> {
  const body = await call({ agent, session, message, system, signal })
  let finish: string | null | undefined
  for await (const event of sseEvents({ body, signal })) {
    if (!event) {
      yield { type: 'dropped' }
      return
    }
    if (event.data === '[DONE]') {
      yield { type: 'done', finish, ended: true }
      return
    }
    if (event.name === 'hermes.tool.progress') {
      yield { type: 'tool', progress: parseJson(event.data) }
      continue
    }
    const chunk = z.safeParse(Chunk, parseJson(event.data)).data
    if (chunk?.error) {
      yield { type: 'error', message: chunk.error.message, lost: LOST.has(chunk.error.message) }
      return
    }
    finish = chunk?.choices?.[0]?.finish_reason ?? finish
    const delta = chunk?.choices?.[0]?.delta?.content
    if (delta) yield { type: 'text', delta }
  }
  yield { type: 'done', finish, ended: false }
}

async function call({ agent, session, message, system, signal }: { agent: { id: string; name: string; net: number; channel_key: string }; session: string; message: object; system: string; signal: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  const until = Date.now() + config.startWaitMs
  const ask = async (): Promise<Response> => {
    const res = await forward.fetch({ agent, path: '/v1/chat/completions', init: {
      method: 'POST',
      headers: { authorization: `Bearer ${unseal(agent.channel_key)}`, 'content-type': 'application/json', 'x-hermes-session-id': session },
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'system', content: system }, message] }),
      signal,
    } }).catch((err: unknown) => err instanceof Error ? err : new Error(String(err)))
    const starting = res instanceof Error || STARTING_STATUS.includes(res.status)
    if (!starting || signal.aborted || Date.now() > until) {
      if (res instanceof Error) throw res
      return res
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    return ask()
  }
  const res = await ask().catch(() => { throw new HttpError(502, signal.aborted ? 'Stopped.' : `${agent.name} isn't answering. Try again, or stop it and start it again.`) })
  if (!res.ok || !res.body) throw new HttpError(502, `${agent.name} couldn't answer. Try again, or stop it and start it again.`)
  return res.body
}

async function* sseEvents({ body, signal }: { body: ReadableStream<Uint8Array>; signal: AbortSignal }): AsyncGenerator<{ name: string; data: string } | undefined> {
  const decoder = new TextDecoder()
  let buffer = ''
  const reads = body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await reads.next().catch((err: unknown) => {
        if (signal.aborted) throw err
        return undefined
      })
      if (!next) {
        yield undefined
        return
      }
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

const parseJson = (text: string): unknown => { try { return JSON.parse(text) } catch { return undefined } }
