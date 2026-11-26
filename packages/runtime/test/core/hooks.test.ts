import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { manifest } from '../../src/core/hooks.ts'
import { gatewayServer } from '../../src/server/gateway/gateway-server.ts'
import { db, migrate } from '../../src/server/platform/db.ts'
import { agentToken, seal } from '../../src/server/platform/secrets.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_hookownr', email: 'hooks@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_hookagnt', name: 'Hooks', owner_id: 'usr_hookownr', instructions: '#', model: 'claude:sonnet', net: 91, channel_key: seal('k'.repeat(48)) }).execute()
const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method: 'POST', headers: { authorization: `Agent ${agentToken({ id: 'ag_hookagnt', epoch: 0 })}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const CARD = '```spec\n{"op":"add","path":"/root","value":"c"}\n{"op":"add","path":"/elements/c","value":{"type":"Card","props":{"title":"Deploy #142"}}}\n```'
test.after(() => server.close())

test('the manifest lists every local tool with its JSON schema, and which hooks the plugins use', () => {
  const { tools, hooks, slack_actions } = manifest()
  assert.deepEqual(tools.map((tool) => tool.name), ['post_message'])
  assert.equal(tools[0].parameters.type, 'object')
  assert.deepEqual(tools[0].parameters.required, ['channel', 'message'])
  assert.equal('$schema' in tools[0].parameters, false)
  assert.deepEqual(hooks, ['pre_gateway_dispatch', 'transform_llm_output'])
  assert.deepEqual(slack_actions, ['card:'])
})

test('a Hermes hook goes to the plugins that handle it: a card becomes text on Telegram, and the app chat and plain words are left alone', async () => {
  const reply = `Shipped.\n\n${CARD}`
  const transform = (args: object) => call('/hooks/transform_llm_output', { args, origin: { platform: 'telegram', chat_id: '123' } }).then((res) => res.json())
  assert.deepEqual(await transform({ response_text: reply, platform: 'telegram', session_id: 's', turn_id: 't' }), { result: 'Shipped.\n\n**Deploy #142**' })
  assert.deepEqual(await transform({ response_text: reply, platform: 'api_server' }), { result: null })
  assert.deepEqual(await transform({ response_text: 'Plain.', platform: 'slack' }), { result: null })
})

test('a Slack card button comes back as the person\'s reply in that thread; other actions are not ours', async () => {
  const body = { channel: { id: 'D0DM' }, message: { ts: '171.01' }, user: { id: 'U1' }, team: { id: 'T1' } }
  assert.deepEqual(await (await call('/slack-actions', { body, action: { action_id: 'card:ok', value: 'Approve' } })).json(), {
    inject: { text: 'Approve', origin: { platform: 'slack', chat_id: 'D0DM', chat_type: 'dm', user_id: 'U1', thread_id: '171.01', scope_id: 'T1' } },
  })
  assert.deepEqual(await (await call('/slack-actions', { body, action: { action_id: 'other:x' } })).json(), {})
})

test('hooks no plugin handles and unknown tools are 404, and a request that does not fit is 400', async () => {
  assert.equal((await call('/hooks/nope', {})).status, 404)
  assert.equal((await call('/tools/nope', { args: {} })).status, 404)
  assert.equal((await call('/hooks/subagent_start', { args: {} })).status, 404, 'no plugin handles it yet')
  assert.equal((await call('/hooks/transform_llm_output', { args: 'nope' })).status, 400)
  assert.equal((await call('/slack-actions', { body: {} })).status, 400)
})
