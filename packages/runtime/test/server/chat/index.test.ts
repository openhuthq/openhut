import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { chat } from '../../../src/server/chat/index.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors, HttpError } from '../../../src/server/platform/http-error.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { HERE } from '../../../src/server/team/home.ts'
import { threadController } from '../../../src/server/threads/thread-controller.ts'
import { threadService } from '../../../src/server/threads/thread-service.ts'
import { post } from '../../../src/plugins/post/index.ts'
import { useFakeRecords } from '../agents/records-fake.ts'

await migrate()
useFakeRecords({ by: HERE })
await db.insertInto('person').values({ id: 'usr_hubownr', email: 'hub@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_hubagent', name: 'Hubby', owner_id: 'usr_hubownr', instructions: '#', model: 'sonnet', net: 41, channel_key: seal('k'.repeat(48)), wanted: 'running', workspace: 'ws_hub' }).execute()

const asked: { session: string; content: string; saved: string[] }[] = []
const hermes = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    const session = String(req.headers['x-hermes-session-id'])
    const content = String((JSON.parse(raw) as { messages: { content: unknown }[] }).messages.at(-1)?.content)
    const thread = await db.selectFrom('chat_thread').select('id').where('id', '=', session.split('.')[0] ?? '').executeTakeFirst()
    asked.push({ session, content, saved: thread ? (await threadService.get({ id: thread.id })).messages.map((message) => message.role) : [] })
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `ECHO: ${content.split('\n').at(-1)}` } }] })}\n\ndata: [DONE]\n\n`)
  })
})
await new Promise<void>((resolve) => hermes.listen(0, '127.0.0.1', resolve))
config.agentApi = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
await app.register(threadController, { prefix: '/api/threads' })
test.after(() => { hermes.close(); return app.close() })

const general = { platform: 'discord', chat_id: '100', chat_name: '' }
const said = (ref: string, text: string, at = new Date()) => ({ ref, at, author: 'Ana', text })
const metadataOf = async (threadId: string) => (await threadService.get({ id: threadId })).messages.map((message) => [message.role, (message.metadata ?? {}) as Record<string, unknown>] as const)

test('a Discord message is saved before the turn, the reply is saved before it is posted, and both stay in one thread per Discord thread', async () => {
  const sent = mock.method(channelService, 'send', async ({ place }: { place: { thread_id?: string } }) => {
    const id = await threadService.placeThread({ agentId: 'ag_hubagent', place: { ...general, thread_id: place.thread_id } })
    const last = (await metadataOf(id)).at(-1)
    assert.deepEqual([last?.[0], last?.[1].delivery], ['assistant', 'pending'], 'the reply is saved before it is posted')
    return { url: '', messageId: '901' }
  })
  const place = { ...general, thread_id: '200', url: 'https://discord.com/channels/1/200' }
  const id = await chat.receive({ agentId: 'ag_hubagent', place, title: 'is prod up?', said: [said('200', 'is prod up?')] })
  assert.equal(asked.at(-1)?.session, id, 'the Hermes session is the thread id')
  assert.deepEqual(asked.at(-1)?.saved, ['user'], 'the message was saved before Hermes was called')
  assert.match(String(asked.at(-1)?.content), /^\(You were asked in this thread\. Your answer is posted here, so don.t also post it in the channel the thread is in\.\)\n\nAna wrote:\nis prod up\?$/, 'a turn from a Discord thread is told to answer there')
  assert.deepEqual(sent.mock.calls.map((call) => call.arguments[0]), [{ agentId: 'ag_hubagent', place, text: 'ECHO: is prod up?' }])
  assert.deepEqual((await metadataOf(id)).map(([role, metadata]) => [role, metadata.delivery ?? null, metadata.ref]), [['user', null, '200'], ['assistant', 'sent', '901']])
  assert.equal(await chat.receive({ agentId: 'ag_hubagent', place, title: 'x', said: [said('201', 'thanks')] }), id, 'the same Discord thread is the same thread')
  assert.notEqual(await chat.receive({ agentId: 'ag_hubagent', place: { ...general, thread_id: '300' }, title: 'y', said: [said('300', 'other')] }), id)
  const thread = await threadService.get({ id })
  assert.deepEqual([thread.title, thread.readOnly, thread.continueUrl], ['is prod up?', true, 'https://discord.com/channels/1/200'])
  const refused = await app.inject({ method: 'POST', url: `/api/threads/${id}/chat`, headers: { authorization: 'Bearer test-key' }, payload: { trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'from the web' }] } } })
  assert.deepEqual([refused.statusCode, refused.json().error.message], [409, 'This thread is in Discord. Reply there.'])
  sent.mock.restore()
})

test('a replayed message is saved once, and a rerun turn with nothing unanswered calls nobody', async () => {
  const sent = mock.method(channelService, 'send', async () => ({ url: '', messageId: '902' }))
  const place = { ...general, thread_id: '400' }
  const at = new Date()
  const id = await chat.receive({ agentId: 'ag_hubagent', place, title: 'once', said: [said('400', 'once', at)] })
  const calls = asked.length
  await chat.receive({ agentId: 'ag_hubagent', place, title: 'once', said: [said('400', 'once', at)] })
  assert.equal(await threadService.answer({ threadId: id }), '')
  await chat.flush(id)
  assert.equal(asked.length, calls)
  assert.equal(sent.mock.callCount(), 1)
  assert.deepEqual((await metadataOf(id)).map(([role]) => role), ['user', 'assistant'])
  sent.mock.restore()
})

test('two messages that arrive before the turn runs get one answer, and a message sent during a turn is still unanswered after it', async () => {
  const sent = mock.method(channelService, 'send', async () => ({ url: '', messageId: '903' }))
  const id = await threadService.placeThread({ agentId: 'ag_hubagent', place: { ...general, thread_id: '500' } })
  const user = (ref: string, text: string, at: Date) => ({ id: threadService.inboundId({ threadId: id, at, ref }), role: 'user' as const, parts: [{ type: 'text', text }], metadata: { author: 'Ana' } })
  await threadService.add({ threadId: id, messages: [user('501', 'first', new Date(Date.now() - 2000)), user('502', 'second', new Date(Date.now() - 1000))] })
  const calls = asked.length
  await threadService.answer({ threadId: id })
  assert.equal(asked.length, calls + 1)
  assert.match(String(asked.at(-1)?.content), /first[\s\S]*second/)
  await threadService.add({ threadId: id, messages: [user('503', 'late', new Date(Date.now() - 500))] })
  await threadService.answer({ threadId: id })
  assert.equal(asked.length, calls + 2, 'a message older than the last reply but not answered by it still gets a turn')
  sent.mock.restore()
})

test('two bots mentioned in one Discord message each keep it in their own thread and each answer in the shared Discord thread', async () => {
  await db.insertInto('agent').values({ id: 'ag_hubother', name: 'Other', owner_id: 'usr_hubownr', instructions: '#', model: 'sonnet', net: 42, channel_key: seal('k'.repeat(48)), wanted: 'running', workspace: 'ws_hub' }).execute()
  const sent = mock.method(channelService, 'send', async () => ({ url: '', messageId: '905' }))
  const place = { ...general, thread_id: '700' }
  const at = new Date()
  const ids = await Promise.all(['ag_hubagent', 'ag_hubother'].map((agentId) => chat.receive({ agentId, place, title: 'both', said: [said('700', 'both of you', at)] })))
  for (const id of ids) assert.deepEqual((await metadataOf(id)).map(([role]) => role), ['user', 'assistant'])
  assert.deepEqual(sent.mock.calls.map(({ arguments: [sent] }) => [sent?.agentId, sent?.place.thread_id]).sort(), [['ag_hubagent', '700'], ['ag_hubother', '700']])
  sent.mock.restore()
})

test('a reply the platform keeps refusing stays saved, marked failed with the reason', async () => {
  const sent = mock.method(channelService, 'send', async () => { throw new HttpError(400, 'The bot can\'t post there.') })
  const place = { ...general, thread_id: '600' }
  await assert.rejects(chat.receive({ agentId: 'ag_hubagent', place, title: 'down', said: [said('600', 'hello?')] }), /can't post there/)
  const id = await threadService.placeThread({ agentId: 'ag_hubagent', place })
  assert.deepEqual((await metadataOf(id)).map(([role, metadata]) => [role, metadata.delivery ?? null, metadata.error ?? null]), [['user', null, null], ['assistant', 'failed', 'The bot can\'t post there.']])
  sent.mock.restore()
})

test('post_message to a Discord channel is saved in that channel\'s thread and delivered from there', async () => {
  const target = mock.method(channelService, 'postTarget', async () => ({ channel: 'ch_hubdisco', chat: '100', place: '#general', target: 'discord:100' }))
  const sent = mock.method(channelService, 'send', async () => ({ url: '', messageId: '904' }))
  const result = await post.tools?.post_message?.run({ channel: 'ch_hubdisco', message: 'Deploy done.' }, { agent: { id: 'ag_hubagent', owner_id: 'usr_hubownr' }, origin: {} } as never)
  assert.equal(result, 'Posted in #general.')
  const id = await threadService.placeThread({ agentId: 'ag_hubagent', place: { ...general, chat_name: '#general' } })
  assert.deepEqual((await threadService.get({ id })).messages.map((message) => [message.role, message.parts[0]?.text, (message.metadata as { delivery?: string }).delivery]), [['assistant', 'Deploy done.', 'sent']])
  assert.deepEqual(sent.mock.calls.map((call) => call.arguments[0]), [{ agentId: 'ag_hubagent', place: { platform: 'discord', chat_id: '100', chat_name: '#general' }, text: 'Deploy done.' }])
  target.mock.restore()
  sent.mock.restore()
})
