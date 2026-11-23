import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { discord } from '../../../../src/server/integrations/discord/discord.ts'

const TOKEN = 'fake-test-token'
const SEEN = '1234567890123456789'
const HIDDEN = '9876543210987654321'

function fakeDiscord(t: TestContext, { flags = 1 << 18, user = 200 } = {}) {
  const calls: { path: string; auth: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    calls.push({ path, auth: new Headers(init?.headers).get('authorization') ?? '' })
    if (path === '/users/@me') return Response.json(user === 200 ? { id: '1', username: 'ops' } : { message: '401: Unauthorized' }, { status: user })
    if (path === '/applications/@me') return Response.json({ id: '1', flags })
    if (path === `/channels/${SEEN}`) return Response.json({ id: SEEN, name: 'on-call' })
    return Response.json({ message: 'Missing Access' }, { status: 403 })
  })
  return calls
}

test('connecting checks the token as a bot, the Message Content intent, and that the bot sees each channel', async (t) => {
  const calls = fakeDiscord(t)
  assert.equal(await discord.verify({ botToken: TOKEN, channels: [SEEN] }), '@ops')
  assert.deepEqual(calls.map((each) => each.path), ['/users/@me', '/applications/@me', `/channels/${SEEN}`])
  assert.ok(calls.every((each) => each.auth === `Bot ${TOKEN}`))
})

test('a wrong token is refused', async (t) => {
  fakeDiscord(t, { user: 401 })
  await assert.rejects(discord.verify({ botToken: TOKEN, channels: [SEEN] }), /didn't accept the bot token \(HTTP 401\)/)
})

test('a bot without the Message Content intent is refused, since Hermes asks for it and Discord would drop the connection', async (t) => {
  fakeDiscord(t, { flags: 0 })
  await assert.rejects(discord.verify({ botToken: TOKEN, channels: [SEEN] }), /Turn on Message Content Intent/)
})

test('a channel the bot can\'t see asks for an invite', async (t) => {
  fakeDiscord(t, { flags: 1 << 19 })
  await assert.rejects(discord.verify({ botToken: TOKEN, channels: [SEEN, HIDDEN] }), new RegExp(`@ops can't see channel ${HIDDEN} \\(HTTP 403\\)\\. Invite it`))
})

test('a public bot is refused, so nobody else can add it to their server', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    if (path === '/users/@me') return Response.json({ id: '1', username: 'ops' })
    return Response.json({ id: '1', flags: 1 << 18, bot_public: true })
  })
  await assert.rejects(discord.verify({ botToken: TOKEN, channels: [] }), /Turn Public Bot off on the Bot page/)
})

test('the invite link carries the bot\'s id and fixed permissions, no secret', () => {
  const id = '1198765432109876543'
  const link = new URL(discord.invite(`${Buffer.from(id).toString('base64')}.GhTq2x.secret-part-of-the-token`))
  assert.equal(link.origin + link.pathname, 'https://discord.com/oauth2/authorize')
  assert.deepEqual(Object.fromEntries(link.searchParams), { client_id: id, permissions: '309237713920', scope: 'bot' })
})

test('channels to pick are the text channels of every server the bot joined, grouped by server', async (t) => {
  const posted: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    if (path === '/users/@me/guilds') return Response.json([{ id: 'g1', name: 'Acme HQ' }])
    if (path === '/guilds/g1/channels') return Response.json([{ id: SEEN, name: 'juniper', type: 0 }, { id: '2', name: 'Voice', type: 2 }, { id: '3', name: 'news', type: 5 }])
    if (path === `/channels/${SEEN}/messages` && init?.method === 'POST') { posted.push(String(init.body)); return Response.json({ id: 'm1' }) }
    return Response.json({}, { status: 404 })
  })
  assert.deepEqual((await discord.conversations({ botToken: TOKEN })).map((each) => [each.name, each.group]), [['juniper', 'Acme HQ'], ['news', 'Acme HQ']])
  assert.deepEqual(await discord.greet({ botToken: TOKEN, ids: [SEEN, HIDDEN], bot: '@Juniper' }), [HIDDEN])
  assert.match(posted[0] ?? '', /Hi, I'm Juniper\. Mention @Juniper and I'll answer in a thread\./)
})
