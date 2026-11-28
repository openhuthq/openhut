import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { discord, gone } from '../../../../src/server/integrations/discord/discord.ts'

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
  await assert.rejects(discord.verify({ botToken: TOKEN, channels: [SEEN, HIDDEN] }), new RegExp(`@ops can't see channel ${HIDDEN}\\. In Discord, open the channel's settings, then Permissions, and add @ops`))
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

test('private channels are listed with whether the bot can read them, from its roles and the channel\'s overwrites', async (t) => {
  const VIEW = String(1 << 10)
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    if (path === '/users/@me/guilds') return Response.json([{ id: 'g1', name: 'Acme HQ' }])
    if (path === '/users/@me') return Response.json({ id: 'bot', username: 'ops' })
    if (path === '/guilds/g1') return Response.json({ id: 'g1', roles: [{ id: 'g1', permissions: VIEW }, { id: 'r-bot', permissions: '0' }, { id: 'r-admin', permissions: String(1 << 3) }] })
    if (path === '/guilds/g1/members/bot') return Response.json({ roles: ['r-bot'] })
    if (path === '/guilds/g1/channels') return Response.json([
      { id: '1', name: 'general', type: 0, permission_overwrites: [] },
      { id: '2', name: 'secret', type: 0, permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: VIEW }] },
      { id: '3', name: 'ops-room', type: 0, permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: VIEW }, { id: 'r-bot', type: 0, allow: VIEW, deny: '0' }] },
      { id: '4', name: 'by-name', type: 0, permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: VIEW }, { id: 'bot', type: 1, allow: VIEW, deny: '0' }] },
      { id: '5', name: 'muted', type: 0, permission_overwrites: [{ id: 'r-bot', type: 0, allow: '0', deny: VIEW }] },
    ])
    return Response.json({}, { status: 404 })
  })
  assert.deepEqual((await discord.conversations({ botToken: TOKEN })).map((each) => [each.name, each.type, each.joined]), [
    ['general', 'public', true], ['secret', 'private', false], ['ops-room', 'private', true], ['by-name', 'private', true], ['muted', 'public', false],
  ])
})

test('a bot with Administrator reads every private channel', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    if (path === '/users/@me/guilds') return Response.json([{ id: 'g1', name: 'Acme HQ' }])
    if (path === '/users/@me') return Response.json({ id: 'bot', username: 'ops' })
    if (path === '/guilds/g1') return Response.json({ id: 'g1', roles: [{ id: 'g1', permissions: '0' }, { id: 'r-admin', permissions: String(1 << 3) }] })
    if (path === '/guilds/g1/members/bot') return Response.json({ roles: ['r-admin'] })
    if (path === '/guilds/g1/channels') return Response.json([{ id: '2', name: 'secret', type: 0, permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: String(1 << 10) }] }])
    return Response.json({}, { status: 404 })
  })
  assert.deepEqual((await discord.conversations({ botToken: TOKEN })).map((each) => [each.type, each.joined]), [['private', true]])
})

test('a server member reads as their server nickname, else their display name, else their username, and says whether it is a bot', async (t) => {
  const members: Record<string, unknown> = {
    '/guilds/1/members/11': { nick: 'El Nazer (DB)', user: { username: 'elnazer', global_name: 'Nazer', bot: true } },
    '/guilds/1/members/12': { nick: null, user: { username: 'ana', global_name: 'Ana' } },
    '/guilds/1/members/13': { user: { username: 'ben' } },
  }
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const found = members[new URL(String(url)).pathname.replace('/api/v10', '')]
    return found ? Response.json(found) : Response.json({ message: 'Unknown Member' }, { status: 404 })
  })
  const person = (userId: string) => discord.person({ botToken: TOKEN, guildId: '1', userId })
  assert.deepEqual(await Promise.all(['11', '12', '13', '14'].map(person)), [{ name: 'El Nazer (DB)', bot: true }, { name: 'Ana', bot: false }, { name: 'ben', bot: false }, undefined])
})

test('a channel, thread or message deleted in Discord reads as gone, on our own calls and the chat adapter\'s', async (t) => {
  const posted: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/api/v10', '')
    if (init?.method === 'POST') posted.push(path)
    if (path === `/channels/${HIDDEN}`) return Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 })
    if (path === `/channels/${SEEN}`) return Response.json({ id: SEEN, guild_id: '1' })
    return Response.json({ message: 'Unknown Message', code: 10008 }, { status: 404 })
  })
  const deleted = await discord.post({ botToken: TOKEN, channelId: HIDDEN, text: 'hi' }).catch((err: unknown) => err)
  assert.ok(gone(deleted))
  assert.deepEqual(posted, [])
  assert.ok(gone(await discord.post({ botToken: TOKEN, channelId: SEEN, text: 'hi' }).catch((err: unknown) => err)))
  assert.ok(gone(new Error('Discord API error: 404 {"message": "Unknown Channel", "code": 10003}')))
  assert.ok(gone(JSON.stringify([{ status: 404, error: '{"message": "Unknown Message", "code": 10008}' }])))
  assert.ok(!gone(new Error('Discord API error: 403 {"message": "Missing Access", "code": 50001}')))
})
