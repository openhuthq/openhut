import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createServer as createSocket } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocketServer, type WebSocket } from 'ws'
import type { MemberList, Record } from '@openhut/common/cloud/cloud.ts'
import { openRecord, sealRecord, type AgentValue } from '@openhut/common/cloud/record.ts'
import { fromBase64, identity, slot, type Identity } from '@openhut/common/vault/vault.ts'

createSocket({ allowHalfOpen: true }, (sock) => sock.setEncoding('utf8').once('data', (line: string) => {
  const req = JSON.parse(line.split('\n')[0] ?? '{}') as { cmd: string; id: string; running?: boolean }
  const replies: { [cmd: string]: object } = { ps: { states: {} }, health: { imageReady: true }, apply: { applied: req.id, change: 'none' }, rm: { removed: req.id } }
  sock.end(JSON.stringify({ ok: true, ...replies[req.cmd] }))
})).listen(process.env.AGENTD_SOCK).unref()

const room = { records: new Map<string, Record>(), seq: 0, lists: [] as MemberList[], puts: new Map<string, number>(), down: false, beforePut: undefined as undefined | ((id: string) => Promise<void>), limit: Infinity, refused: 0 }
const sockets = new Set<WebSocket>()
const store = (record: Omit<Record, 'seq' | 'object'>): Record => {
  const saved = { ...record, object: 'record' as const, seq: ++room.seq }
  room.records.set(saved.id, saved)
  return saved
}
const push = (record: Record) => { for (const ws of sockets) ws.send(JSON.stringify({ type: 'record', record })) }
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const url = new URL(req.url ?? '', 'http://room')
  if (room.down) return reply(503, {})
  if (url.pathname.endsWith('/member-lists')) return reply(200, { object: 'list', data: room.lists.slice(Number(url.searchParams.get('after'))), hasMore: false })
  if (url.pathname.endsWith('/records')) return reply(200, { object: 'list', data: [...room.records.values()].filter((each) => each.seq > Number(url.searchParams.get('after'))).sort((a, b) => a.seq - b.seq), hasMore: false })
  const id = /\/records\/([^/]+)$/.exec(url.pathname)?.[1]
  if (!id || req.method !== 'PUT') return reply(404, {})
  await room.beforePut?.(id)
  if (room.limit <= 0) {
    room.refused++
    return reply(429, { error: { type: 'rate_limit_error', message: 'Too many requests.' } })
  }
  room.limit--
  const body = JSON.parse(Buffer.concat(chunks).toString()) as { ver: number; deleted: boolean; body: string }
  if (body.ver !== (room.records.get(id)?.ver ?? 0) + 1) return reply(409, { error: { type: 'invalid_request_error', message: 'stale' } })
  room.puts.set(id, (room.puts.get(id) ?? 0) + 1)
  const saved = store({ id, ...body })
  push(saved)
  reply(200, saved)
})
new WebSocketServer({ server }).on('connection', (ws) => {
  if (room.down) return ws.terminate()
  ws.on('message', () => { sockets.add(ws); ws.send(JSON.stringify({ type: 'ready', version: 1 })) })
  ws.on('close', () => sockets.delete(ws))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { seal } = await import('../../../src/server/platform/secrets.ts')
const { agentService } = await import('../../../src/server/agents/agent-service.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { syncService } = await import('../../../src/server/cloud/sync-service.ts')
await migrate()
const actor = { id: 'usr_syncowner', email: 'mo@example.com', local: true }
await db.insertInto('person').values({ id: actor.id, email: actor.email, role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_helpdesk', name: 'Helpdesk', owner_id: actor.id, instructions: '# Helpdesk', model: 'claude:sonnet', net: 3, channel_key: seal('k'.repeat(32)) }).execute()
const account = await keysService.open({ sub: 'dev-mo', email: actor.email })
await keysService.setSession({ token: 'session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
room.lists.push(account.list)
const workspace = account.workspace.id
const key = fromBase64(account.workspace.key)
const helpdeskId = await slot({ key, path: 'agent/ag_helpdesk' })
const members = keysService.members()?.members ?? []
const me = await keysService.device()

async function until(check: () => boolean | Promise<boolean>, what: string, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await sleep(50)
  }
  assert.fail(`timed out waiting for ${what}`)
}
const nameHere = async () => (await db.selectFrom('agent').select('name').where('id', '=', 'ag_helpdesk').executeTakeFirstOrThrow()).name
const nameInRoom = async () => {
  const opened = await openRecord({ workspace, keys: { 1: key }, record: room.records.get(helpdeskId) as Record, members })
  return opened?.kind === 'agent' ? opened.value?.name : undefined
}
const helpdesk = (name: string): AgentValue => ({ id: 'ag_helpdesk', name, instructions: '# Helpdesk', model: 'claude:sonnet', face: null, codeExecution: true, wanted: 'stopped' })
const remote = async ({ name, id = helpdeskId, ver = (room.records.get(id)?.ver ?? 0) + 1, signer = me }: { name: string; id?: string; ver?: number; signer?: Identity }) => {
  const sealed = await sealRecord({ workspace, key, version: 1, signer, id, ver, kind: 'agent', ref: 'ag_helpdesk', value: helpdesk(name) })
  assert.ok(sealed)
  return { id, ...sealed }
}

test('first sign-in uploads everything once; an edit made offline goes out once on reconnect', async () => {
  syncService.connect()
  await until(() => room.records.size === 5 && syncService.status().at !== null, 'the first backup and its head')
  assert.deepEqual([...room.puts.values()], [1, 1, 1, 1, 1])
  assert.equal(await nameInRoom(), 'Helpdesk')
  assert.equal(JSON.stringify([...room.records.values()]).includes('Helpdesk'), false)

  room.down = true
  for (const ws of sockets) ws.terminate()
  await until(() => !syncService.ready(), 'the socket to drop')
  await agentService.update({ actor, id: 'ag_helpdesk', patch: { name: 'Offline edit' } })
  await sleep(600)
  assert.equal(room.puts.get(helpdeskId), 1)
  room.down = false
  await until(async () => await nameInRoom() === 'Offline edit', 'the offline edit to land')
  await sleep(600)
  assert.equal(room.puts.get(helpdeskId), 2)
})

test('a remote change applies here', async () => {
  push(store(await remote({ name: 'Support' })))
  await until(async () => await nameHere() === 'Support', 'the remote change')
  await sleep(600)
  assert.equal(room.records.get(helpdeskId)?.ver, 3)
  assert.equal(syncService.status().done <= syncService.status().total, true)
})

test('the same race ends the same on both sides: the room’s first write wins', async () => {
  room.beforePut = async (id) => {
    room.beforePut = undefined
    if (id === helpdeskId) push(store(await remote({ name: 'Theirs' })))
  }
  await agentService.update({ actor, id: 'ag_helpdesk', patch: { name: 'Mine' } })
  await until(async () => await nameHere() === 'Theirs', 'the other side to win here')
  await sleep(600)
  assert.equal(await nameInRoom(), 'Theirs')
  assert.equal(await nameHere(), 'Theirs')
})

test('an evil room’s forged, replayed, reordered or old records change nothing', async () => {
  const ver = room.records.get(helpdeskId)?.ver ?? 0
  const old = await remote({ name: 'Rolled back', ver: 1 })
  push(store(await remote({ name: 'Forged', signer: await identity() })))
  push({ ...(room.records.get(helpdeskId) as Record), ver: ver + 5, seq: ++room.seq })
  push({ ...store(old), ver: 1 })
  await sleep(800)
  assert.equal(await nameHere(), 'Theirs')
  room.records.set(helpdeskId, { ...(room.records.get(helpdeskId) as Record), ver: ver + 1 })
  push(store(await remote({ name: 'After a gap', ver: ver + 2 })))
  await until(async () => await nameHere() === 'After a gap', 'a valid change after the lies')
})

test('a record placed at another record’s slot is dropped', async () => {
  const usageSlot = await slot({ key, path: 'setting/usage_data' })
  const usage = room.records.get(usageSlot) as Record
  push(store(await remote({ name: 'Wrong slot', id: usageSlot })))
  await sleep(800)
  assert.equal(await nameHere(), 'After a gap')
  room.records.set(usageSlot, usage)
})

test('a value that doesn’t fit is never reported backed up, and the backup is retried once it is fixed', async () => {
  const at = syncService.status().at
  await db.insertInto('agent').values({ id: 'ag_toolong1', name: 'x'.repeat(41), owner_id: actor.id, instructions: '', model: 'claude:sonnet', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
  syncService.send()
  await until(() => syncService.status().state === 'failed', 'the backup to fail')
  assert.equal(syncService.status().at, at)
  await db.updateTable('agent').set({ name: 'Fits now' }).where('id', '=', 'ag_toolong1').execute()
  await until(() => syncService.status().state === 'idle' && syncService.status().at !== at, 'the retry to back it up', 400)
})

test('200 agents back up in full through a rate limit: failed while any is unsent, retried with backoff, never Up to date early', async () => {
  for (let i = 0; i < 200; i++) {
    await db.insertInto('agent').values({ id: `ag_bulk${String(i).padStart(4, '0')}`, name: `Bulk ${i}`, owner_id: actor.id, instructions: '', model: 'claude:sonnet', net: 10 + i, channel_key: seal('k'.repeat(32)) }).execute()
  }
  const at = syncService.status().at
  room.limit = 120
  syncService.send()
  await until(() => syncService.status().state === 'failed', 'the rate limit to stop the backup')
  assert.equal(syncService.status().at, at)
  assert.ok(room.refused > 0)
  room.limit = Infinity
  await until(() => syncService.status().state === 'idle' && syncService.status().at !== at, 'the retry to finish', 600)
  const bulk = await Promise.all(Array.from({ length: 200 }, (_, i) => slot({ key, path: `agent/ag_bulk${String(i).padStart(4, '0')}` })))
  assert.equal(bulk.every((id) => room.records.has(id)), true)
})

test('a full restore checks the signed head and says so plainly when the cloud leaves records out', async () => {
  const omitted = await slot({ key, path: 'agent/ag_bulk0007' })
  const kept = room.records.get(omitted) as Record
  room.records.delete(omitted)
  await syncService.reset({ restoring: true })
  syncService.connect()
  await until(() => syncService.status().problem !== null, 'the head check')
  assert.match(syncService.status().problem ?? '', /^OpenHut Cloud sent an incomplete or older backup: 1 of \d+ agents and settings are missing or out of date\.$/)
  await until(() => syncService.status().state === 'idle', 'the restore to end')
  room.records.set(omitted, kept)
  await syncService.reset({ restoring: true })
  syncService.connect()
  await until(() => syncService.status().state === 'idle', 'a clean restore')
  await sleep(300)
  assert.equal(syncService.status().problem, null)
})
