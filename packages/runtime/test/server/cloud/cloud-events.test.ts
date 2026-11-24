import { after, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocketServer, type WebSocket } from 'ws'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { padded } from '@openhut/common/records/seal.ts'
import { fromBase64, identity, newKey, toBase64 } from '@openhut/common/vault/public.ts'
import { lock, unlock } from '@openhut/common/vault/secret.ts'

const requests: unknown[] = []
const refuse = new Map<string, number>()
const http = createServer((req, res) => {
  const [, , , team = '', kind] = new URL(req.url ?? '/', 'http://x').pathname.split('/')
  const left = kind === 'member-list' ? refuse.get(team) ?? 0 : 0
  if (left > 0) {
    refuse.set(team, left - 1)
    return res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { type: 'forbidden', message: 'Not in this team.' } }))
  }
  const json = kind === 'join-request' ? { object: 'list', data: requests } : { object: 'list', data: [] }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(json))
})
const sockets = new WebSocketServer({ server: http })
const sent: { type: string; workspace: string; body: string }[] = []
let peer: WebSocket | undefined
sockets.on('connection', (ws) => ws.on('message', (data) => {
  const message = JSON.parse(String(data)) as { type: string; token?: string; workspace: string; body: string }
  if (message.type === 'hello' && message.token === 'session-token') {
    peer = ws
    ws.send(JSON.stringify({ object: 'ready', workspaces: [] }))
  } else sent.push(message)
}))
http.listen(0, '127.0.0.1')
await once(http, 'listening')
const address = http.address()
process.env.OPENHUT_API_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
await migrate()
const { listen } = await import('../../../src/server/platform/events.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
const { recordsService } = await import('../../../src/server/cloud/records.ts')
const { cloudEvents, BEAT_MS } = await import('../../../src/server/cloud/cloud-events.ts')
const { presence, lockHere, openHere } = await import('../../../src/server/cloud/presence.ts')
after(() => {
  cloudEvents.stop()
  sockets.close()
  http.close()
})

const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
const ws = account.workspace.id
const key = fromBase64(account.workspace.key)
const me = await keysService.deviceKey()
const phone = await identity()
const body = roomKeys.members(ws)
assert.ok(body)
const at = Math.max(Date.now(), body.at ?? 0)
const phoneKey = toBase64(phone.publicKey)
assert.ok(await roomKeys.advance({ ws, lists: [await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(account.list), at, added: { ...body.added, [phoneKey]: at }, members: [...body.members, { email: 'ana@example.com', role: 'member', devices: [phoneKey] }] } })] }))
const emitted: { name: string; type?: string; id?: string }[] = []
listen((event) => emitted.push({ name: event.name, type: event.target?.type, id: event.target?.id }))

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await sleep(20)
  assert.ok(check(), `waited for ${what}`)
}

async function opened(beat: { body: string }): Promise<unknown> {
  const plain = await unlock({ keys: { 1: key }, bind: `beat/${ws}/${me}`, locked: fromBase64(beat.body) })
  return plain && JSON.parse(new TextDecoder().decode(plain))
}

test('a record notice becomes the renderer’s LiveEvent and a records change; a join request notice refreshes the requests', async () => {
  const changes: unknown[] = []
  const stop = recordsService.onChange((change) => changes.push(change))
  cloudEvents.start()
  await until(() => cloudEvents.ready() && Boolean(peer), 'the events socket to be ready')
  peer?.send(JSON.stringify({ object: 'control', id: 'ag_events01', ver: 3, workspace: ws }))
  peer?.send(JSON.stringify({ object: 'message', id: 'msg_events01', ver: 1, workspace: ws }))
  await until(() => changes.length === 2, 'both notices')
  assert.deepEqual(changes, [{ collection: 'control', id: 'ag_events01', ver: 3, workspace: ws }, { collection: 'message', id: 'msg_events01', ver: 1, workspace: ws }])
  assert.deepEqual(emitted.filter((each) => each.name.endsWith('.changed') && each.type !== 'cloud').map((each) => `${each.type}:${each.id}`), ['agent:ag_events01', 'grant:ag_events01', 'thread:msg_events01'])
  requests.push({ id: toBase64((await identity()).publicKey), object: 'join_request', workspace: ws, email: 'mo@example.com', asked: true, at: new Date().toISOString(), name: 'Mo’s iPhone', os: 'iOS', server: false })
  peer?.send(JSON.stringify({ object: 'join_request', id: 'jr_1', ver: 1, workspace: ws }))
  await until(() => cloudEvents.requests(ws).length === 1, 'the join request to show')
  assert.equal(cloudEvents.requests(ws)[0]?.name, 'Mo’s iPhone')
  assert.ok(emitted.some((each) => each.name === 'cloud.changed' && each.id === ws))
  stop()
})

test('the runner beat goes out sealed on ready, and a teammate’s beat and presence are heard', async () => {
  await until(() => sent.some((each) => each.type === 'beat'), 'the first beat')
  const beat = sent.find((each) => each.type === 'beat')
  assert.ok(beat)
  assert.equal(beat.workspace, ws)
  assert.doesNotMatch(Buffer.from(beat.body, 'base64url').toString('latin1'), /build|version/)
  assert.deepEqual(Object.keys(await opened(beat) as object).sort(), ['agents', 'at', 'build', 'kind', 'os', 'version'], 'agent statuses and the OS ride the beat')

  const from = toBase64(phone.publicKey)
  const plain = padded({ json: JSON.stringify({ at: Date.now(), build: 'phone-build', version: '1.0.0', kind: 'phone' }) })
  assert.ok(plain)
  const theirs = await lock({ key, version: 1, bind: `beat/${ws}/${from}`, plain })
  const stranger = toBase64((await identity()).publicKey)
  peer?.send(JSON.stringify({ object: 'beat', workspace: ws, from: stranger, body: toBase64(theirs ?? new Uint8Array()) }))
  peer?.send(JSON.stringify({ object: 'beat', workspace: ws, from, body: toBase64(theirs ?? new Uint8Array()) }))
  await until(() => cloudEvents.beats(ws).has(from), 'the teammate’s beat')
  assert.equal(cloudEvents.beats(ws).get(from)?.build, 'phone-build')
  assert.equal(cloudEvents.beats(ws).has(stranger), false)

  const list = roomKeys.members(ws)
  assert.ok(list)
  const here = await lockHere({ workspace: ws, key, version: 1, from, value: { agent: 'ag_events01', field: 'instructions', typing: true, at: Date.now(), list: list.version, listHash: await anchorOf(roomKeys.room(ws)?.list ?? account.list) } })
  peer?.send(JSON.stringify({ object: 'presence', workspace: ws, from, body: here }))
  await until(() => presence.view().people.length === 1, 'the teammate’s presence')
  assert.deepEqual(presence.view().people.map((each) => [each.agentId, each.field, each.typing]), [['ag_events01', 'instructions', true]])
  const away = await lockHere({ workspace: ws, key, version: 1, from, value: { agent: null, field: null, typing: false, at: Date.now(), list: list.version, listHash: await anchorOf(roomKeys.room(ws)?.list ?? account.list) } })
  peer?.send(JSON.stringify({ object: 'presence', workspace: ws, from, body: away }))
  await until(() => presence.view().people.length === 0, 'the teammate to leave')
})

test('the beat repeats every 10 s while idle', async () => {
  cloudEvents.stop()
  sent.length = 0
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    cloudEvents.start()
    await until(() => sent.filter((each) => each.type === 'beat').length === 1, 'the beat on ready')
    mock.timers.tick(BEAT_MS)
    await until(() => sent.filter((each) => each.type === 'beat').length === 2, 'the second beat')
    mock.timers.tick(BEAT_MS)
    await until(() => sent.filter((each) => each.type === 'beat').length === 3, 'the third beat')
  } finally {
    mock.timers.reset()
  }
})

test('a Here is locked to its sender, padded to one fixed size, and opens only with the workspace key', async () => {
  const from = toBase64(phone.publicKey)
  const value = { agent: 'ag_helpdesk', field: 'instructions' as const, typing: false, at: 1, list: 3, listHash: 'y'.repeat(43) }
  const body = await lockHere({ workspace: ws, key, version: 1, from, value })
  const other = await lockHere({ workspace: ws, key, version: 1, from, value: { ...value, agent: null, field: null, list: 999 } })
  assert.ok(body && other)
  assert.equal(body.length, other.length)
  assert.deepEqual(await openHere({ workspace: ws, keys: { 1: key }, from, body }), value)
  assert.equal(await openHere({ workspace: ws, keys: { 1: key }, from: me, body }), null)
  assert.equal(await openHere({ workspace: ws, keys: { 1: newKey() }, from, body }), null)
  assert.equal(Buffer.from(body, 'base64url').includes('ag_helpdesk'), false)
  assert.equal(await lockHere({ workspace: ws, key, version: 1, from, value: { ...value, agent: 'ag_x'.repeat(200) } }), null)
})

async function aTeam(id: string, key: string): Promise<void> {
  const list = await signList({ signer: await keysService.device(), body: { workspace: id, version: 1, previous: null, members: [{ email: 'boss@example.com', role: 'owner', devices: [phoneKey] }, { email: 'mo@example.com', role: 'member', devices: [me] }], invites: [], removed: [] } })
  await roomKeys.setRoom({ workspace: { id, key, version: 1 }, list, first: list })
}

test('a 403 for a team while joining it, or just once, doesn\'t drop the team; one that lasts does', async () => {
  cloudEvents.start()
  await until(() => !!peer, 'events running')
  await aTeam('JoiningTeam01', '')
  refuse.set('JoiningTeam01', Infinity)
  await cloudEvents.refreshKeys('JoiningTeam01')
  await aTeam('BlipTeam00001', toBase64(newKey()))
  refuse.set('BlipTeam00001', 1)
  await cloudEvents.refreshKeys('BlipTeam00001')
  await aTeam('GoneTeam00001', toBase64(newKey()))
  refuse.set('GoneTeam00001', Infinity)
  await cloudEvents.refreshKeys('GoneTeam00001')
  await sleep(2600)
  assert.ok(roomKeys.room('JoiningTeam01'), 'a team still waiting for its key stays')
  assert.ok(roomKeys.room('BlipTeam00001'), 'a team refused once stays')
  await until(() => !roomKeys.room('GoneTeam00001'), 'the team that keeps refusing to drop')
})

test('a team that removed this computer is still named after a restart, with who owns it', async () => {
  await aTeam('KeptGone00001', toBase64(newKey()))
  await cloudEvents.drop({ ws: 'KeptGone00001', why: 'removed' })
  const { cloudEvents: restarted } = await import(`../../../src/server/cloud/cloud-events.ts?restart=${Date.now()}`) as typeof import('../../../src/server/cloud/cloud-events.ts')
  assert.deepEqual((await restarted.gone()).at(-1), { name: 'Boss’s team', why: 'removed', owner: 'boss@example.com' })
})
