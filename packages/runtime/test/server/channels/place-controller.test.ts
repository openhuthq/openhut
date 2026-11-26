import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { placeController } from '../../../src/server/channels/place-controller.ts'
import { split } from '../../../src/server/integrations/discord/discord.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'

const TOKEN = 'fake-discord-token'
const OPS = '1234567890123456789'
const RANDOM = '5555555555555555555'
const GUILD = '4444444444444444444'
const KEY = { authorization: 'Bearer test-key' }
const PLACE = { platform: 'discord', chat_id: OPS, chat_name: '#ops' }

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_placeown', email: 'place@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_placeops', name: 'Ops', owner_id: 'usr_placeown', instructions: '#', model: 'claude:sonnet', net: 91, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
await db.insertInto('channel').values([
  { id: 'ch_placedis', agent_id: 'ag_placeops', kind: 'discord', status: 'connected', account: '@ops', owner_address: '', open: false, allowed: OPS, secrets: seal(JSON.stringify({ botToken: TOKEN })) },
  { id: 'ch_placetgm', agent_id: 'ag_placeops', kind: 'telegram', status: 'connected', account: '@ops_bot', owner_address: '123456789', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: 'tg' })) },
]).execute()
signIn()
await refresh()

const app = Fastify()
app.setValidatorCompiler(validatorCompiler)
answerErrors(app)
await app.register(placeController, { prefix: '/api/agents/:id/places' })
await app.ready()

function fakeDiscord(t: TestContext, { limited = 0 } = {}) {
  const calls: { method: string; path: string; body: { content?: string } }[] = []
  let left = limited
  let next = 100
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : {} })
    assert.equal(new Headers(init?.headers).get('authorization'), `Bot ${TOKEN}`)
    if (path.startsWith('/users/@me') || path.startsWith('/guilds')) return Response.json(path === '/users/@me/guilds' ? [{ id: GUILD, name: 'Acme' }] : path === `/guilds/${GUILD}/channels` ? [{ id: OPS, name: 'ops', type: 0 }] : path === `/guilds/${GUILD}` ? { roles: [] } : path === '/users/@me' ? { id: '1', username: 'ops' } : { roles: [] })
    if (left-- > 0) return Response.json({ message: 'You are being rate limited.', retry_after: 0.01 }, { status: 429 })
    return Response.json({ id: String(next++) })
  })
  return calls
}

test('places are the Discord channels the agent has connected, with readable names, and only for its owner\'s team', async (t) => {
  fakeDiscord(t)
  const res = await app.inject({ url: '/api/agents/ag_placeops/places', headers: KEY })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { object: 'list', url: '/api/agents/ag_placeops/places', hasMore: false, data: [PLACE] })
  assert.equal((await app.inject({ url: '/api/agents/ag_nobody00/places', headers: KEY })).statusCode, 404)
})

test('send posts to the channel with the agent\'s bot, splits long text and waits out a rate limit', async (t) => {
  const calls = fakeDiscord(t, { limited: 1 })
  await channelService.send({ agentId: 'ag_placeops', place: PLACE, text: `${'a'.repeat(1500)}\n${'b'.repeat(1500)}` })
  const posts = calls.filter((each) => each.method === 'POST')
  assert.deepEqual(posts.map((each) => each.path), [`/channels/${OPS}/messages`, `/channels/${OPS}/messages`, `/channels/${OPS}/messages`])
  assert.deepEqual(posts.slice(1).map((each) => each.body.content), ['a'.repeat(1500), 'b'.repeat(1500)])
})

test('send posts into an existing thread, and refuses a channel the agent has not connected', async (t) => {
  const calls = fakeDiscord(t)
  await channelService.send({ agentId: 'ag_placeops', place: { ...PLACE, thread_id: '8888888888888888888' }, text: 'done' })
  assert.ok(calls.some((each) => each.method === 'POST' && each.path === '/channels/8888888888888888888/messages'))
  await assert.rejects(channelService.send({ agentId: 'ag_placeops', place: { ...PLACE, chat_id: RANDOM, chat_name: '#random' }, text: 'hi' }), /Can't post in #random/)
  await assert.rejects(channelService.send({ agentId: 'ag_placeops', place: { platform: 'telegram', chat_id: '123456789', chat_name: 'your Telegram' }, text: 'hi' }), /can't post to telegram yet/)
})

test('long text splits at line breaks, then spaces, under Discord\'s 2000 characters', () => {
  assert.deepEqual(split('short'), ['short'])
  const parts = split(`${'word '.repeat(900)}`)
  assert.ok(parts.every((part) => part.length <= 2000))
  assert.equal(parts.join(' '), 'word '.repeat(900).trim())
  assert.deepEqual(split('x'.repeat(4500)).map((part) => part.length), [2000, 2000, 500])
})
