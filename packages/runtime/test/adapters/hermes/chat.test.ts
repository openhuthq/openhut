import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chat } from '../../../src/adapters/hermes/chat.ts'
import type { ChatEvent } from '../../../src/core/agent.ts'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'

await migrate()
const agent = { id: 'ag_chatadpt', name: 'Runner', net: 31, channel_key: seal('k'.repeat(48)) }
const RUN = 'chatcmpl-0123456789abcdef'
const frame = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`
const chunk = (delta: object) => frame({ id: RUN, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })

const seen: string[] = []
let stream: ServerResponse | undefined
const hermes = createServer((req, res) => {
  seen.push(`${req.method} ${req.url} ${req.headers.authorization === `Bearer ${'k'.repeat(48)}` ? 'auth' : 'no-auth'}${stream?.writableEnded === false ? ' while streaming' : ''}`)
  req.resume()
  if (req.url === `/v1/runs/${RUN}/stop`) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ run_id: RUN, status: 'stopping' }))
  stream = res
  res.on('close', () => seen.push('stream closed'))
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(chunk({ role: 'assistant' }))
  res.write(frame({ kind: 'provider_wait', text: 'Waiting for the model to answer' }, 'hermes.status'))
  res.write(frame({ tool: 'terminal', label: 'vite dev --port 8813', toolCallId: 'call_1', status: 'running' }, 'hermes.tool.progress'))
})
await new Promise<void>((resolve) => hermes.listen(0, '127.0.0.1', resolve))
config.agentApi = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`
test.after(() => hermes.close())

test('a long tool call streams as it starts, and stopping the turn stops the Hermes run before the stream closes', async () => {
  const stopping = new AbortController()
  const events: ChatEvent[] = []
  const reading = (async () => {
    for await (const event of chat({ agent, session: agent.id, message: { role: 'user', content: 'fix the mock' }, system: '', signal: stopping.signal })) {
      events.push(event)
      if (event.type === 'tool') stopping.abort()
    }
  })()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.deepEqual(events, [
    { type: 'status', text: 'Waiting for the model to answer' },
    { type: 'tool', progress: { tool: 'terminal', label: 'vite dev --port 8813', toolCallId: 'call_1', status: 'running' } },
  ])
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(seen, ['POST /v1/chat/completions auth', `POST /v1/runs/${RUN}/stop auth while streaming`, 'stream closed'])
})
