import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'

const slackApi = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, channels: [{ id: 'C0PULSE001', name: 'pulse', is_member: true, num_members: 4 }] }))).listen(0, '127.0.0.1')
await new Promise((resolve) => slackApi.once('listening', resolve))
Object.assign(config, { slackApi: `http://127.0.0.1:${(slackApi.address() as AddressInfo).port}` })

await migrate()
await db.insertInto('person').values({ id: 'usr_postowner', email: 'post@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values([
  { id: 'ag_postpulse', name: 'Pulse', owner_id: 'usr_postowner', instructions: '#', model: 'claude:sonnet', net: 81, channel_key: seal('k'.repeat(48)), wanted: 'running' },
  { id: 'ag_postother', name: 'Ops', owner_id: 'usr_postowner', instructions: '#', model: 'claude:sonnet', net: 82, channel_key: seal('k'.repeat(48)), wanted: 'running' },
]).execute()
await db.insertInto('channel').values([
  { id: 'ch_postslack', agent_id: 'ag_postpulse', kind: 'slack', status: 'connected', account: null, owner_address: '', open: false, allowed: 'C0PULSE001,C0OTHER002', secrets: seal(JSON.stringify({ botToken: 'xoxb-test', appToken: 'xapp-test' })) },
  { id: 'ch_posttgram', agent_id: 'ag_postpulse', kind: 'telegram', status: 'connected', account: '@pulse_bot', owner_address: '123456789', open: false, allowed: '987654321', secrets: '' },
  { id: 'ch_postwhats', agent_id: 'ag_postpulse', kind: 'whatsapp', status: 'linking', account: null, owner_address: '15550003333', open: true, allowed: '', secrets: '' },
  { id: 'ch_postdisco', agent_id: 'ag_postother', kind: 'discord', status: 'connected', account: '@ops', owner_address: '', open: false, allowed: '1234567890123456789', secrets: '' },
]).execute()

test('an agent can post only in the chats its own connected channels answer in', async () => {
  assert.deepEqual(await channelService.postTargets({ agentId: 'ag_postpulse' }), [
    { channel: 'ch_postslack', chat: 'C0PULSE001', place: '#pulse', target: 'slack:C0PULSE001' },
    { channel: 'ch_postslack', chat: 'C0OTHER002', place: 'Slack channel C0OTHER002', target: 'slack:C0OTHER002' },
    { channel: 'ch_posttgram', chat: '123456789', place: 'your Telegram', target: 'telegram:123456789' },
    { channel: 'ch_posttgram', chat: '987654321', place: 'Telegram chat 987654321', target: 'telegram:987654321' },
  ])
  assert.equal((await channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_postslack' })).target, 'slack:C0PULSE001')
  assert.equal((await channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_posttgram', chat: '987654321' })).target, 'telegram:987654321')
  await assert.rejects(channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_postslack', chat: 'C0RANDOM99' }), /only post in your own channels: ch_postslack C0PULSE001 \(#pulse\)/)
  await assert.rejects(channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_postdisco' }), { status: 400 })
  await assert.rejects(channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_postwhats' }), { status: 400 })
})

test('an open Telegram channel posts only to its owner, and an agent with no channels is told so', async () => {
  await db.updateTable('channel').set({ open: true }).where('id', '=', 'ch_posttgram').execute()
  await assert.rejects(channelService.postTarget({ agentId: 'ag_postpulse', channel: 'ch_posttgram', chat: '987654321' }), { status: 400 })
  await db.updateTable('channel').set({ open: false }).where('id', '=', 'ch_posttgram').execute()
  await db.deleteFrom('channel').where('id', '=', 'ch_postdisco').execute()
  await assert.rejects(channelService.postTarget({ agentId: 'ag_postother', channel: 'ch_postdisco' }), /no channels to post in/)
})

test('the gateway answers the plugin\'s post_message only with the calling agent\'s own targets', async () => {
  const server = gatewayServer.create().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/messages/target`
  const post = (body: unknown, token = agentToken({ id: 'ag_postpulse', epoch: 0 })) => fetch(url, { method: 'POST', headers: { authorization: `Agent ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.deepEqual(await (await post({ channel: 'ch_postslack' })).json(), { object: 'message_target', target: 'slack:C0PULSE001', place: '#pulse' })
  assert.equal((await post({ channel: 'ch_postslack' }, agentToken({ id: 'ag_postother', epoch: 0 }))).status, 400)
  assert.equal((await post({ nope: true })).status, 400)
  assert.equal((await post({ channel: 'ch_postslack' }, 'nope')).status, 401)
  server.close()
  slackApi.close()
})
