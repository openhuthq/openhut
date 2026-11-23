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
