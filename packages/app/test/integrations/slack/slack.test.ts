import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { slack } from '../../../src/integrations/slack/slack.ts'

const CHANNELS = [
  { id: 'C0SUPPORT', name: 'support', is_private: false, is_member: true, num_members: 42 },
  { id: 'C0DESIGN', name: 'design', is_private: false, is_member: false, num_members: 8 },
  { id: 'G0LEADERS', name: 'leadership', is_private: true, is_member: false, num_members: 6 },
  { id: 'G0OPS', name: 'ops', is_private: true, is_member: true, num_members: 5 },
  { id: 'C0PARTNER', name: 'partner-acme', is_private: false, is_member: true, num_members: 30, is_ext_shared: true },
  { id: 'C0NONAME' },
]
const GROUP_DMS = [{ id: 'G0MPIM', name: 'mpdm-mo--sara--gus-1', is_private: true, is_mpim: true, is_member: true, num_members: 3 }]

function fakeSlack(t: TestContext, { scopes = 'channels:read,channels:join,chat:write' } = {}) {
  const calls: { method: string; params: URLSearchParams }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split('/').at(-1) ?? ''
    calls.push({ method, params: new URLSearchParams(String(init?.body ?? '')) })
    const headers = { 'x-oauth-scopes': scopes }
    if (method === 'auth.test') return Response.json({ ok: true, team: 'Acme', user: 'gus' }, { headers })
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
  assert.equal(await slack.verify({ botToken: 'xoxb-1-x', appToken: 'xapp-1-x' }), 'Acme · @gus')
})

test('an app that takes direct messages is refused, since anyone in the workspace could DM it', async (t) => {
  fakeSlack(t, { scopes: 'channels:read,im:history,chat:write' })
  await assert.rejects(slack.verify({ botToken: 'xoxb-1-x', appToken: 'xapp-1-x' }), /takes direct messages, so anyone in Acme/)
  await assert.rejects(slack.enter({ botToken: 'xoxb-1-x', ids: ['C0DESIGN'], agentName: 'Gus' }), /takes direct messages/)
})
