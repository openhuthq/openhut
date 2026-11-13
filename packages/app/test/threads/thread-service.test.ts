import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import { db, migrate } from '../../src/platform/db.ts'
import { answerErrors } from '../../src/platform/http-error.ts'
import { seal, sha } from '../../src/platform/secrets.ts'
import { validateWithZod } from '../../src/platform/validation.ts'
import { threadController } from '../../src/threads/thread-controller.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_chatownr', email: 'owner@example.com', pass: 'x', role: 'owner', removed_at: null },
  { id: 'usr_chatothr', email: 'other@example.com', pass: 'x', role: 'member', removed_at: null },
]).execute()
await db.insertInto('agent').values([
  { id: 'ag_chatrunn', name: 'Runner', owner_id: 'usr_chatownr', instructions: '# Runner', model: 'sonnet', net: 21, channel_key: seal('k'.repeat(48)), wanted: 'running' },
  { id: 'ag_chatstop', name: 'Sleeper', owner_id: 'usr_chatownr', instructions: '# Sleeper', model: 'sonnet', net: 22, channel_key: seal('k'.repeat(48)) },
]).execute()
await db.insertInto('session').values([
  { hash: sha('owner-session'), person_id: 'usr_chatownr', expires_at: new Date(Date.now() + 3_600_000) },
  { hash: sha('other-session'), person_id: 'usr_chatothr', expires_at: new Date(Date.now() + 3_600_000) },
]).execute()

const seen: { auth?: string; body?: { stream: boolean; messages: { role: string; content: string }[] } } = {}
const hermes = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    seen.auth = req.headers.authorization
    seen.body = JSON.parse(raw)
    await db.insertInto('connection_event').values({ agent_id: 'ag_chatrunn', connection_id: null, tool: 'postgres_query', reason: 'count orders', outcome: 'allowed', ms: 12 }).execute()
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
    res.end(`: keepalive\n\n${chunk('Let me ')}${chunk('check.')}event: hermes.tool.progress\ndata: {"tool":"call_tool","label":"postgres_query"}\n\n${chunk('214 orders.')}data: [DONE]\n\n`)
  })
})
await new Promise<void>((resolve) => hermes.listen(18642, '127.0.0.1', resolve))

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
await app.register(threadController, { prefix: '/api/threads' })
const as = (who: 'owner' | 'other') => ({ cookie: `fm_session=${who}-session` })
const newThread = async (agentId: string) => (await app.inject({ method: 'POST', url: '/api/threads', headers: as('owner'), payload: { agentId, title: '  How many   orders? ' } })).json()
const say = (threadId: string, text: string, who: 'owner' | 'other' = 'owner') => app.inject({
  method: 'POST', url: `/api/threads/${threadId}/chat`, headers: as(who),
  payload: { trigger: 'submit-message', message: { id: `m${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] } },
})

test.after(() => { hermes.close(); return app.close() })

test('a turn streams the agent\'s reply in order, with its tool use and gateway calls, and is saved', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal(thread.title, 'How many orders?')
  const res = await say(thread.id, 'How many orders?')
  assert.equal(res.statusCode, 200)
  assert.equal(seen.auth, `Bearer ${'k'.repeat(48)}`)
  assert.deepEqual(seen.body?.messages, [{ role: 'user', content: 'How many orders?' }])
  assert.equal(seen.body?.stream, true)
  const types = res.body.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)).type)
  assert.deepEqual(types, ['start', 'text-start', 'text-delta', 'text-delta', 'text-end', 'data-tool', 'text-start', 'text-delta', 'text-end', 'data-calls', 'finish'])
  const saved = (await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: as('owner') })).json()
  assert.deepEqual(saved.messages.map((message: { role: string }) => message.role), ['user', 'assistant'])
  const answer = saved.messages[1].parts
  assert.deepEqual(answer.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text), ['Let me check.', '214 orders.'])
  assert.deepEqual(answer.find((part: { type: string }) => part.type === 'data-calls').data, [{ tool: 'postgres_query', connectionName: null, outcome: 'allowed', reason: 'count orders', ms: 12 }])
})

test('the next turn sends the whole conversation, and a retry replaces the last answer', async () => {
  const thread = await newThread('ag_chatrunn')
  await say(thread.id, 'First')
  await say(thread.id, 'Second')
  assert.deepEqual(seen.body?.messages.map((message) => message.role), ['user', 'assistant', 'user'])
  await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/chat`, headers: as('owner'), payload: { trigger: 'regenerate-message' } })
  assert.deepEqual(seen.body?.messages.map((message) => message.content), ['First', 'Let me check.214 orders.', 'Second'])
  const saved = (await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: as('owner') })).json()
  assert.equal(saved.messages.length, 4)
})

test('threads are private, and a stopped agent says so before anything is sent', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal((await say(thread.id, 'hi', 'other')).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: '/api/threads', headers: as('other') })).json().data.length, 0)
  assert.equal((await app.inject({ method: 'POST', url: '/api/threads', headers: as('other'), payload: { agentId: 'ag_chatrunn', title: 'x' } })).statusCode, 403)
  const stopped = await newThread('ag_chatstop')
  const res = await say(stopped.id, 'hi')
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.message, 'Sleeper is stopped. Start it and try again.')
})

test('an agent that isn\'t answering ends the turn with a sentence, not a hang', async () => {
  await new Promise((resolve) => hermes.close(resolve))
  const thread = await newThread('ag_chatrunn')
  const res = await say(thread.id, 'hi')
  const error = res.body.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6))).find((chunk) => chunk.type === 'error')
  assert.match(error.errorText, /^Runner isn't reachable\. Hermes isn't answering on port 8642 \(ECONNREFUSED\)\.$/)
})
