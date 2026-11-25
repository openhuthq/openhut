import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

// A fake Telegram that says where an update came from.
const direct: string[] = []
const fake = createServer((req, res) => {
  direct.push(req.url ?? '')
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: [{ update_id: 7, from: 'telegram' }] }))
}).listen(0, '127.0.0.1')
await once(fake, 'listening')
const { config } = await import('../../../src/server/platform/config.ts')
Object.assign(config, { telegramApi: `http://127.0.0.1:${(fake.address() as AddressInfo).port}` })

const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { agentToken, seal } = await import('../../../src/server/platform/secrets.ts')
const { cloud } = await import('../../../src/server/platform/cloud.ts')
const { gatewayServer } = await import('../../../src/server/gateway/gateway-server.ts')

await migrate()
await db.insertInto('person').values({ id: 'usr_inboxown', email: 'inbox@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_inboxtt', name: 'Dev', owner_id: 'usr_inboxown', instructions: '# Dev', model: 'sonnet', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
await db.insertInto('channel').values({ id: 'ch_inboxtg', agent_id: 'ag_inboxtt', kind: 'telegram', status: 'connected', owner_address: '111', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: '123456:REAL-bot-token' })) }).execute()

const asked: { id: string; after?: number }[] = []
cloud.channels.list = async () => ({ status: 200, json: { object: 'list', data: [{ object: 'channel', id: 'ch_cloud', agent: 'ag_inboxtt', kind: 'telegram' }] } })
cloud.channels.events = async (input) => {
  asked.push(input)
  return { status: 200, json: { object: 'list', data: [{ object: 'channel_event', id: 42, body: { update_id: 9001, message: { text: 'from the inbox' } } }] } }
}

const gateway = gatewayServer.create().listen(0, '127.0.0.1')
await once(gateway, 'listening')
const gw = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
after(() => { gateway.close(); fake.close() })

const getUpdates = (body: object) => fetch(`${gw}/u/telegram/botSTAND-IN/getUpdates`, { method: 'POST', headers: { authorization: `Bearer ${agentToken({ id: 'ag_inboxtt', epoch: 0 })}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('on a Cloud computer, getUpdates is answered from the Cloud inbox, never from Telegram', async () => {
  config.cloudComputer = true
  try {
    const res = await getUpdates({ offset: 42, timeout: 30 })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true, result: [{ update_id: 42, message: { text: 'from the inbox' } }] })
    assert.deepEqual(asked, [{ id: 'ch_cloud', after: 41 }], 'Hermes\'s offset acknowledges events up to it on the Cloud')
    assert.deepEqual(direct, [])
  } finally { config.cloudComputer = false }
})

test('on your own computer, getUpdates goes to Telegram directly with the real token', async () => {
  asked.length = 0
  const res = await getUpdates({ offset: 1 })
  assert.deepEqual(await res.json(), { ok: true, result: [{ update_id: 7, from: 'telegram' }] })
  assert.deepEqual(direct, ['/bot123456:REAL-bot-token/getUpdates'])
  assert.deepEqual(asked, [])
})
