import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { SealedRow } from '@openhut/common/records/wire.ts'

const rows = new Map<string, SealedRow>()
const cloud = { down: false }
const server = createServer(async (req, res) => {
  if (cloud.down) return req.socket.destroy()
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {}
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const url = new URL(req.url ?? '/', 'http://cloud')
  const [, , , team = '', collection = '', id] = url.pathname.split('/')
  if (req.method === 'PUT') {
    const current = rows.get(`${collection}/${id}`)
    if (body.ver !== (current?.ver ?? 0) + 1) return reply(409, { error: { type: 'invalid_request_error', message: 'Someone else changed this record first.' }, current })
    const row = { id, object: collection, ...body } as SealedRow
    rows.set(`${collection}/${id}`, row)
    return reply(200, row)
  }
  const all = [...rows.values()].filter((row) => row.object === collection)
  if (req.method === 'POST') return reply(200, { object: 'list', url: url.pathname, hasMore: false, data: all.filter((row) => (body.ids as string[]).includes(row.id)) })
  if (id) return rows.has(`${collection}/${id}`) ? reply(200, rows.get(`${collection}/${id}`)) : reply(404, { error: { type: 'invalid_request_error', message: 'No such record.' } })
  const parent = url.searchParams.get('parent')
  reply(200, { object: 'list', url: url.pathname, hasMore: false, data: all.filter((row) => row.workspace === team && (!parent || row.parent === parent)) })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
process.env.OPENHUT_API_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
await migrate()
const { db } = await import('../../../src/server/platform/db.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { recordsService } = await import('../../../src/server/cloud/records.ts')
const { seal, signer } = await import('@openhut/common/records/seal.ts')
const { fromBase64 } = await import('@openhut/common/vault/vault.ts')
after(() => server.close())

const account = await keysService.open({ sub: 'dev-sara', email: 'sara@example.com' })
await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
const ws = account.workspace.id
const agent = { collection: 'agent', workspace: ws, id: 'ag_records1', parent: 'sara@example.com' } as const

async function sealedAt({ ver, value }: { ver: number; value: unknown }): Promise<SealedRow> {
  const keys = () => ({ version: 1, keys: { 1: fromBase64(account.workspace.key) } })
  const sealed = await seal({ where: { ...agent }, ver, value: { workspace: value }, keys, signer: signer(await keysService.device()) })
  assert.ok(sealed)
  return { id: agent.id, object: 'agent', ...sealed }
}

test('a put comes back from get and list sealed, with its personal part and its vault secret', async () => {
  const saved = await recordsService.put({ ...agent, value: { name: 'Juniper' } })
  assert.deepEqual([saved?.ver, saved?.value], [1, { name: 'Juniper' }])
  assert.deepEqual((await recordsService.get(agent))?.value, { name: 'Juniper' })
  await recordsService.put({ collection: 'connection', workspace: ws, id: 'cn_records1', value: { name: 'Gmail', kind: 'google' }, secret: { token: 'secret-token' }, personal: true })
  const [connection] = await recordsService.list({ collection: 'connection', workspace: ws })
  assert.deepEqual([connection?.value, connection?.secret, connection?.personal], [{ name: 'Gmail', kind: 'google' }, { token: 'secret-token' }, true])
  assert.doesNotMatch(JSON.stringify([...rows.values()]), /Gmail|secret-token|Juniper/)
  assert.equal(await recordsService.held('ag_records1'), 1)
})

test('a 409 hands the newer record to reapply, and a put without reapply answers 409', async () => {
  rows.set(`agent/${agent.id}`, await sealedAt({ ver: 2, value: { name: 'Juno', face: 'fox' } }))
  const merged = await recordsService.put({ ...agent, value: { name: 'Mine' }, reapply: (current) => ({ value: { ...current.value as object, name: 'Mine' } }) })
  assert.deepEqual([merged?.ver, merged?.value], [3, { name: 'Mine', face: 'fox' }])
  rows.set(`agent/${agent.id}`, await sealedAt({ ver: 4, value: { name: 'Elsewhere' } }))
  await assert.rejects(recordsService.put({ ...agent, value: { name: 'Blind' } }), (err: Error & { status?: number }) => err.status === 409)
  assert.equal(await recordsService.held(agent.id), 4)
  rows.set(`agent/${agent.id}`, await sealedAt({ ver: 5, value: { name: 'Elsewhere again' } }))
  const kept = await recordsService.put({ ...agent, value: { name: 'Ignored' }, reapply: () => null })
  assert.deepEqual([kept?.ver, kept?.value], [5, { name: 'Elsewhere again' }])
})

test('a read refuses a version older than the one this computer has seen', async () => {
  rows.set(`agent/${agent.id}`, await sealedAt({ ver: 2, value: { name: 'Rolled back' } }))
  assert.equal(await recordsService.get(agent), null)
  assert.deepEqual(await recordsService.list({ collection: 'agent', workspace: ws }), [])
  assert.equal(await recordsService.held(agent.id), 5)
  rows.set(`agent/${agent.id}`, await sealedAt({ ver: 6, value: { name: 'Juniper' } }))
})

test('runner writes wait in the outbox while the cloud is down and land once it answers again', async () => {
  cloud.down = true
  const message = { collection: 'message', workspace: ws, parent: agent.id } as const
  await assert.rejects(recordsService.put({ ...agent, value: { name: 'Offline edit' } }), (err: Error & { status?: number }) => err.status === 502)
  assert.equal(await recordsService.put({ ...message, id: 'msg_records1', value: { text: 'first' }, queue: true }), null)
  assert.equal(await recordsService.put({ ...message, id: 'msg_records1', value: { text: 'first, edited' }, queue: true }), null)
  assert.equal(await recordsService.put({ ...message, id: 'msg_records2', value: { text: 'second' }, queue: true }), null)
  await recordsService.drain()
  assert.equal((await db.selectFrom('record_outbox').select('id').execute()).length, 2)
  cloud.down = false
  await recordsService.drain()
  assert.deepEqual((await db.selectFrom('record_outbox').select('id').execute()), [])
  assert.deepEqual((await recordsService.list({ ...message })).map((each) => each.value), [{ text: 'first, edited' }, { text: 'second' }])
  await recordsService.remove({ ...message, id: 'msg_records2', queue: true })
  assert.equal((await recordsService.get({ ...message, id: 'msg_records2' }))?.deleted, true)
})
