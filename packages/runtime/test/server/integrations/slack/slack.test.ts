import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { slack } from '../../../../src/server/integrations/slack/slack.ts'

const CHANNELS = [
  { id: 'C0SUPPORT', name: 'support', is_private: false, is_member: true, num_members: 42 },
  { id: 'C0DESIGN', name: 'design', is_private: false, is_member: false, num_members: 8 },
  { id: 'G0LEADERS', name: 'leadership', is_private: true, is_member: false, num_members: 6 },
  { id: 'G0OPS', name: 'ops', is_private: true, is_member: true, num_members: 5 },
  { id: 'C0PARTNER', name: 'partner-acme', is_private: false, is_member: true, num_members: 30, is_ext_shared: true },
  { id: 'C0NONAME' },
]
const GROUP_DMS = [{ id: 'G0MPIM', name: 'mpdm-mo--sara--gus-1', is_private: true, is_mpim: true, is_member: true, num_members: 3 }]

const SETUP = { botToken: 'xoxb-1-x', appToken: 'xapp-1-x', configToken: 'xoxe.xoxp-1-x', icon: Buffer.from('png').toString('base64'), agentName: 'Gus' }

function fakeSlack(t: TestContext, { scopes = 'channels:read,channels:join,chat:write', iconError = '' } = {}) {
  const calls: { method: string; token: string; params: URLSearchParams; form?: FormData }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split('/').at(-1) ?? ''
    const form = init?.body instanceof FormData ? init.body : undefined
    calls.push({ method, token: new Headers(init?.headers).get('authorization') ?? '', params: new URLSearchParams(form ? '' : String(init?.body ?? '')), form })
    const headers = { 'x-oauth-scopes': scopes }
    if (method === 'auth.test') return Response.json({ ok: true, team: 'Acme', user: 'gus', bot_id: 'B0GUS' }, { headers })
    if (method === 'bots.info') return Response.json({ ok: true, bot: { app_id: 'A0GUS' } }, { headers })
    if (method === 'apps.icon.set' && iconError) return Response.json({ ok: false, error: iconError })
    if (method === 'conversations.list') {
      const channels = new URLSearchParams(String(init?.body ?? '')).get('types') === 'mpim' ? GROUP_DMS : CHANNELS
      return Response.json({ ok: true, channels, response_metadata: { next_cursor: '' } }, { headers })
    }
    return Response.json({ ok: true }, { headers })
  })
  return calls
}

test('every kind of channel is listed: public, private ones the bot is in, shared ones, and group DMs by their people', async (t) => {
  const calls = fakeSlack(t)
  const listed = await slack.conversations({ botToken: 'xoxb-1-x' })
  assert.deepEqual(calls.map((each) => each.params.get('types')), ['public_channel,private_channel', 'mpim'])
  assert.deepEqual(listed.map((each) => [each.name, each.type, each.shared]), [
    ['design', 'public', false], ['mo, sara, gus', 'group', false], ['ops', 'private', false], ['partner-acme', 'public', true], ['support', 'public', false],
  ])
  assert.deepEqual(listed.find((each) => each.id === 'G0OPS'), { id: 'G0OPS', object: 'conversation', name: 'ops', type: 'private', shared: false, members: 5, joined: true })
})

test('entering channels joins only the public ones the bot is not in yet', async (t) => {
  const calls = fakeSlack(t)
  await slack.enter({ botToken: 'xoxb-1-x', ids: ['C0SUPPORT', 'C0DESIGN', 'G0OPS'], agentName: 'Gus' })
  assert.deepEqual(calls.filter((each) => each.method === 'conversations.join').map((each) => each.params.get('channel')), ['C0DESIGN'])
})

test('a private channel the bot is not in asks for an invite instead of joining', async (t) => {
  const calls = fakeSlack(t)
  await assert.rejects(slack.enter({ botToken: 'xoxb-1-x', ids: ['G0LEADERS'], agentName: 'Gus' }), /Gus can't see that channel in Slack\. If it's private, type \/invite @gus in it first/)
  await slack.enter({ botToken: 'xoxb-1-x', ids: ['C0PARTNER', 'G0MPIM'], agentName: 'Gus' })
  assert.equal(calls.filter((each) => each.method === 'conversations.join').length, 0)
})

test('an app that can read group DMs is fine, since Hermes holds group DMs to the channel list', async (t) => {
  fakeSlack(t, { scopes: 'channels:read,mpim:history,mpim:read' })
  assert.equal(await slack.verify(SETUP), 'Acme · @gus')
})

test('an app that takes direct messages is refused, since anyone in the workspace could DM it', async (t) => {
  fakeSlack(t, { scopes: 'channels:read,im:history,chat:write' })
  await assert.rejects(slack.verify(SETUP), /takes direct messages, so anyone in Acme/)
  await assert.rejects(slack.enter({ botToken: 'xoxb-1-x', ids: ['C0DESIGN'], agentName: 'Gus' }), /takes direct messages/)
})

test('connecting gives the app its face: the bot names its app, and the config token sets that app\'s icon', async (t) => {
  const calls = fakeSlack(t)
  await slack.verify(SETUP)
  assert.equal(calls.find((each) => each.method === 'bots.info')?.params.get('bot'), 'B0GUS')
  const set = calls.find((each) => each.method === 'apps.icon.set')
  assert.equal(set?.token, 'Bearer xoxe.xoxp-1-x')
  assert.equal(set?.form?.get('app_id'), 'A0GUS')
  const file = set?.form?.get('file')
  assert.ok(file instanceof Blob)
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'png')
})

test('a config token Slack refuses stops the connect with a field error on it', async (t) => {
  fakeSlack(t, { iconError: 'token_expired' })
  await assert.rejects(slack.verify(SETUP), (err: { status: number; param?: string; message: string }) =>
    err.status === 400 && err.param === 'configToken' && /Slack didn't give Gus its face \(token_expired\)/.test(err.message))
})
