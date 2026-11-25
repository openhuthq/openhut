import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { request, type RequestOptions } from 'node:http'
import type { AddressInfo } from 'node:net'
import { userInfo } from 'node:os'
import { duplexPair } from 'node:stream'
import Fastify from 'fastify'
import { bodyOf, signList } from '@openhut/common/cloud/member-list.ts'
import { identity, newKey, toBase64 } from '@openhut/common/vault/public.ts'
import { agentController } from '../../../src/server/agents/agent-controller.ts'
import { visibleTo } from '../../../src/server/agents/agent-service.ts'
import { cloudController } from '../../../src/server/cloud/cloud-controller.ts'
import { keyStore } from '../../../src/server/cloud/key-store.ts'
import { keysService } from '../../../src/server/cloud/keys-service.ts'
import { keysService as inner } from '@openhut/common/keyring/keys.ts'
import { adminController } from '../../../src/server/admin/admin-controller.ts'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { listenLocally, stepUp, tagDevice, tunnelKeyOf, who } from '../../../src/server/team/identity.ts'
import { userPresence } from '../../../src/server/cloud/user-presence.ts'
import { meController } from '../../../src/server/team/team-controller.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.addHook('preHandler', stepUp)
app.get('/caller', async (req) => who(req))
for (const url of ['/api/threads/:id', '/api/threads/:id/chat']) app.route({ method: url.endsWith('chat') ? 'POST' : 'GET', url, handler: async (req) => who(req) })
await app.register(meController, { prefix: '/api/me' })
await app.register(agentController, { prefix: '/api/agents' })
await app.register(cloudController, { prefix: '/api/cloud' })
await app.register(adminController, { prefix: '/api/admin' })
await app.listen({ port: 0, host: '127.0.0.1' })
const local = await listenLocally({ server: app.server, path: config.socket })
const tcp = { host: '127.0.0.1', port: (app.server.address() as AddressInfo).port }
const device = (key: string) => () => {
  const [ours, theirs] = duplexPair()
  app.server.emit('connection', tagDevice({ conn: ours, key }))
  return theirs
}
const ask = (options: RequestOptions & { body?: unknown }) => new Promise<{ status?: number; body: { local?: boolean; email?: string; user?: { email: string } } }>((done, fail) => {
  const { body, ...rest } = options
  const out = request({ path: '/caller', ...rest, headers: { ...rest.headers, ...body !== undefined && { 'content-type': 'application/json' } } }, (res) => {
    let text = ''
    res.setEncoding('utf8').on('data', (chunk: string) => { text += chunk }).on('end', () => done({ status: res.statusCode, body: JSON.parse(text) }))
  }).on('error', fail)
  out.end(body === undefined ? undefined : JSON.stringify(body))
})

const viewer = await identity()
const teammate = await identity()
const housemate = await identity()
const stranger = await identity()
const VIEWER = tunnelKeyOf(toBase64(viewer.publicKey))
const TEAMMATE = tunnelKeyOf(toBase64(teammate.publicKey))
const HOUSEMATE = tunnelKeyOf(toBase64(housemate.publicKey))
const TEAM = toBase64(newKey(12))

async function listDevices(): Promise<void> {
  const account = await keysService.open({ sub: 'google-mo', email: 'mo@example.com' })
  const list = await keysService.addDevice({ device: toBase64(viewer.publicKey), name: null }) ?? account.list
  const me = await inner.device()
  const body = bodyOf(list)
  assert.ok(body)
  const home = await signList({ signer: me, body: { ...body, version: body.version + 1, members: [...body.members, { email: 'ana@example.com', role: 'member', devices: [toBase64(housemate.publicKey)] }] } })
  const team = await signList({ signer: me, body: { workspace: TEAM, version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices: [toBase64(me.publicKey)] }, { email: 'sara@example.com', role: 'member', devices: [toBase64(teammate.publicKey)] }], invites: [], removed: [] } })
  await keyStore.write({ ...await keyStore.read(), account: { ...account, list: home, teams: [{ workspace: { id: TEAM, key: toBase64(newKey()), version: 1 }, list: team, first: team }] } })
  await db.insertInto('person').values({ id: 'usr_tunnelown', email: 'owner', role: 'owner', removed_at: null }).onConflict((oc) => oc.doNothing()).execute()
  const owner = await db.selectFrom('person').select('id').where('role', '=', 'owner').executeTakeFirstOrThrow()
  await db.insertInto('agent').values([
    { id: 'ag_tshared', name: 'Shared', owner_id: owner.id, instructions: '# Shared', model: 'sonnet', net: 41, channel_key: 'k', workspace: TEAM, shared: true },
    { id: 'ag_tprivate', name: 'Private', owner_id: owner.id, instructions: '# Private', model: 'sonnet', net: 42, channel_key: 'k', workspace: TEAM, shared: false },
    { id: 'ag_tpicked', name: 'Picked', owner_id: owner.id, instructions: '# Picked', model: 'sonnet', net: 45, channel_key: 'k', workspace: TEAM, shared: false, people: '["sara@example.com"]' },
    { id: 'ag_thomeshared', name: 'Home shared', owner_id: owner.id, instructions: '# Home', model: 'sonnet', net: 43, channel_key: 'k', workspace: null, shared: true },
    { id: 'ag_thomeprivate', name: 'Home private', owner_id: owner.id, instructions: '# Home', model: 'sonnet', net: 44, channel_key: 'k', workspace: null, shared: false },
  ]).execute()
}

test('a server install listens on TCP and on a socket only its own user can open', () => {
  assert.equal(config.installKind, 'server')
  assert.equal(statSync(config.socket).mode & 0o777, 0o600)
})

test('a request on the socket is the owner and local, with or without a key', async () => {
  const owner = await ask({ socketPath: config.socket })
  assert.equal(owner.status, 200)
  assert.equal(owner.body.local, true)
  assert.deepEqual(await ask({ socketPath: config.socket, headers: { authorization: 'Bearer wrong-key' } }), owner)
  const me = await ask({ socketPath: config.socket, path: '/api/me' })
  assert.equal(me.status, 200)
  assert.equal(me.body.user?.email, userInfo().username)
})

test('over TCP only the key the app enrolled gets in, and it counts as local like the socket', async () => {
  assert.equal((await ask(tcp)).status, 401)
  assert.equal((await ask({ ...tcp, headers: { authorization: 'Bearer wrong-key' } })).status, 401)
  assert.equal((await ask({ ...tcp, path: '/api/me' })).status, 401)
  const owner = await ask({ socketPath: config.socket })
  assert.deepEqual(await ask({ ...tcp, headers: { authorization: 'Bearer test-key' } }), owner)
  assert.equal((await ask({ ...tcp, path: '/api/me', headers: { authorization: 'Bearer test-key' } })).status, 200)
})

test('a device\'s connection is refused while no member list holds it, key or not', async () => {
  assert.equal((await ask({ createConnection: device(VIEWER) })).status, 401)
  assert.equal((await ask({ createConnection: device(VIEWER), headers: { authorization: 'Bearer test-key' } })).status, 401)
  assert.equal((await ask({ createConnection: device(VIEWER), path: '/api/me' })).status, 401)
})

test('over the tunnel your own device (a phone, a browser) uses the whole app, but every trust route stays on the computer: devices, keys, the kit, sign-in, deleting data', async () => {
  await listDevices()
  const chat = await ask({ createConnection: device(VIEWER), method: 'POST', path: '/api/threads/ag_tprivate/chat', body: {} })
  assert.deepEqual([chat.status, chat.body.local, chat.body.email], [200, false, 'mo@example.com'])
  for (const [method, path, body] of [
    ['GET', '/api/agents', undefined],
    ['POST', '/api/agents', { name: 'From the browser' }],
    ['PATCH', '/api/agents/ag_tprivate', { wanted: 'stopped' }],
    ['GET', '/api/cloud', undefined],
  ] as const) assert.notEqual((await ask({ createConnection: device(VIEWER), method, path, body })).status, 403, `${method} ${path}`)
  for (const [method, path, body] of [
    ['POST', `/api/cloud/workspaces/${TEAM}/requests/${toBase64(stranger.publicKey)}/approvals`, undefined],
    ['DELETE', `/api/cloud/devices/${toBase64(stranger.publicKey)}`, undefined],
    ['POST', '/api/cloud/sessions', undefined],
    ['DELETE', '/api/cloud/session', undefined],
    ['DELETE', '/api/cloud', undefined],
  ] as const) assert.equal((await ask({ createConnection: device(VIEWER), method, path, body })).status, 403, `${method} ${path}`)
})

test('W5: on a server that is the account’s only computer, your browser saves the first recovery kit over the tunnel; once a kit exists, the kit stays on a computer', async () => {
  const kits = async () => (await ask({ createConnection: device(VIEWER), method: 'POST', path: '/api/cloud/kits' })).status
  const kit = mock.method(keysService, 'kitState', () => ({ saved: null, pending: null }))
  try {
    assert.notEqual(await kits(), 403)
    kit.mock.mockImplementation(() => ({ saved: { box: 'b', savedAt: '2026-11-24T10:00:00Z' }, pending: null }))
    assert.equal(await kits(), 403)
  } finally {
    kit.mock.restore()
  }
})

test('SEC2: a powerful change from your browser waits for this computer’s approval (Touch ID here), and goes through only once it is given; chat never asks', async () => {
  const reasons: string[] = []
  let answer = false
  const presence = mock.method(userPresence, 'ask', async (reason: string) => { reasons.push(reason); return answer })
  try {
    const change = () => ask({ createConnection: device(VIEWER), method: 'PATCH', path: '/api/agents/ag_tprivate', body: { instructions: '# New' } })
    const refused = await change()
    assert.equal(refused.status, 403)
    assert.match(JSON.stringify(refused.body), /Not confirmed on your computer/)
    answer = true
    assert.notEqual((await change()).status, 403, 'after the computer confirms, the same request goes through')
    assert.notEqual((await ask({ createConnection: device(VIEWER), method: 'DELETE', path: '/api/agents/ag_tnothere' })).status, 403)
    assert.equal(reasons.length, 3)
    answer = false
    assert.notEqual((await ask({ createConnection: device(VIEWER), method: 'PATCH', path: '/api/agents/ag_tprivate', body: { wanted: 'stopped' } })).status, 403, 'starting or stopping isn’t powerful')
    assert.equal((await ask({ createConnection: device(VIEWER), method: 'POST', path: '/api/threads/ag_tprivate/chat', body: {} })).status, 200)
    assert.notEqual((await ask({ socketPath: config.socket, method: 'PATCH', path: '/api/agents/ag_tprivate', body: { instructions: '# Here' } })).status, 403, 'the computer’s own window never steps up')
    assert.equal(reasons.length, 3)
  } finally {
    presence.mock.restore()
  }
})

test('SEC10: over the tunnel a teammate lists only the agents shared in their teams, and reaches nothing else of the owner’s', async () => {
  const control = (people: string[]) => ({ runsOn: 'k', model: 'claude:sonnet', codeExecution: true, browser: false, grants: [], people, sidebars: [] })
  const all = [
    { id: 'shared', workspace: TEAM, personal: false, owner: 'mo@example.com', control: control([]) },
    { id: 'private', workspace: TEAM, personal: true, owner: 'mo@example.com', control: control([]) },
    { id: 'picked', workspace: TEAM, personal: true, owner: 'mo@example.com', control: control(['sara@example.com']) },
    { id: 'home', workspace: 'home', personal: false, owner: 'mo@example.com', control: control([]) },
  ]
  assert.deepEqual(visibleTo({ actor: { teammate: [TEAM], email: 'sara@example.com' }, all }).map((each) => each.id), ['shared', 'picked'])
  assert.deepEqual(visibleTo({ actor: { teammate: [TEAM], email: 'ana@example.com' }, all }).map((each) => each.id), ['shared'], 'only the people picked see a picked agent')
  assert.deepEqual(visibleTo({ actor: { email: 'mo@example.com' }, all }).map((each) => each.id), ['shared', 'private', 'picked', 'home'])
  const caller = await ask({ createConnection: device(TEAMMATE), path: '/api/agents' })
  assert.notEqual(caller.status, 403, 'a teammate may list, and the list holds only what is shared with them')
  for (const [method, path] of [['GET', '/api/agents/ag_tshared'], ['GET', '/api/me'], ['GET', '/api/cloud'], ['GET', '/api/admin'], ['POST', '/api/cloud/web-links']] as const) {
    assert.equal((await ask({ createConnection: device(TEAMMATE), method, path, body: method === 'POST' ? { path: '/' } : undefined })).status, 403, `${method} ${path}`)
  }
})

test('over the tunnel a teammate chats only with agents shared in their workspace, and a stranger gets nothing', async () => {
  const shared = await ask({ createConnection: device(TEAMMATE), path: '/api/threads/ag_tshared' })
  assert.deepEqual([shared.status, shared.body.email, shared.body.local], [200, 'sara@example.com', false])
  assert.equal((await ask({ createConnection: device(TEAMMATE), method: 'POST', path: '/api/threads/ag_tprivate/chat', body: {} })).status, 403)
  assert.equal((await ask({ createConnection: device(TEAMMATE), method: 'POST', path: '/api/threads/ag_tpicked/chat', body: {} })).status, 200, 'a person picked on Access chats with it')
  assert.equal((await ask({ createConnection: device(HOUSEMATE), path: '/api/threads/ag_tpicked' })).status, 403)
  assert.equal((await ask({ createConnection: device(TEAMMATE), method: 'PATCH', path: '/api/agents/ag_tshared', body: { wanted: 'stopped' } })).status, 403)
  assert.equal((await ask({ createConnection: device(tunnelKeyOf(toBase64(stranger.publicKey))), path: '/api/threads/ag_tshared' })).status, 401)
})

test('a teammate in the owner\'s own team chats with its shared agents, while teammates from other teams and private agents stay out', async () => {
  const shared = await ask({ createConnection: device(HOUSEMATE), path: '/api/threads/ag_thomeshared' })
  assert.deepEqual([shared.status, shared.body.email, shared.body.local], [200, 'ana@example.com', false])
  assert.equal((await ask({ createConnection: device(HOUSEMATE), method: 'POST', path: '/api/threads/ag_thomeshared/chat', body: {} })).status, 200)
  assert.equal((await ask({ createConnection: device(HOUSEMATE), path: '/api/threads/ag_thomeprivate' })).status, 403)
  assert.equal((await ask({ createConnection: device(HOUSEMATE), path: '/api/threads/ag_tshared' })).status, 403)
  assert.equal((await ask({ createConnection: device(TEAMMATE), path: '/api/threads/ag_thomeshared' })).status, 403)
})

test.after(async () => {
  local.close()
  await app.close()
})
