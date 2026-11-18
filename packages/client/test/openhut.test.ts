import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { canonical, verify, type Access, type Unsigned } from '@openhut/common/access/access.ts'
import type { Admin } from '@openhut/common/admin/admin.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Connection, ConnectionKind } from '@openhut/common/connections/connection.ts'
import { createOpenHut, mergeProviders, type Platform, type StoredComputer } from '../src/openhut.ts'

const AT = '2026-11-17T00:00:00.000Z'

type Fake = {
  up: boolean
  refuseImport?: boolean
  downAfterImport?: boolean
  codexAt?: string
  keys: Record<string, string>
  agents: Agent[]
  connections: (Connection & { secret?: string })[]
  seat: { at: string | null; token: string }
  calls: string[]
  access?: Access
  relayKey?: string
}

function fake(): Fake {
  return { up: true, keys: {}, agents: [], connections: [], seat: { at: null, token: '' }, calls: [] }
}

function agent(name: string): Agent {
  return { id: `ag_${name.toLowerCase()}`, object: 'agent', name, ownerId: 'usr_a', ownerName: 'me', model: 'claude:sonnet', helperModels: { compress: null, title: null, review: null }, wanted: 'running', status: 'running', health: 'answering', healthDetail: '', summary: '', net: 0, instructions: '', codeExecution: false, browser: false, canEdit: true, createdAt: AT }
}

function connection({ id, kind, name, secret }: { id: string; kind: ConnectionKind; name: string; secret?: string }): Connection & { secret?: string } {
  return { id, object: 'connection', kind, name, account: '', signIn: !secret, ownerId: 'usr_a', ownerName: 'me', everyone: false, usable: true, canDelete: true, agents: 0, status: 'connected', lastSuccessAt: null, createdAt: AT, secret }
}

function providerOf({ id, runtime }: { id: string; runtime: Fake }) {
  const key = runtime.keys[id]
  return { id, object: 'provider', kind: 'key', name: id, connected: !!key, keyHint: key ? `${key.slice(0, 3)}…` : null, updatedAt: key ? AT : null, models: key ? [{ id: 'm1', name: 'M1', on: true, tier: 'big', note: null, contextLength: null, inputPrice: null, outputPrice: null }] : [] }
}

function adminOf({ id, runtime }: { id: string; runtime: Fake }): Admin {
  return {
    object: 'admin', seat: { set: !!runtime.seat.token, mode: 'claude', updatedAt: runtime.seat.at }, codex: { set: !!runtime.codexAt, updatedAt: runtime.codexAt ?? null },
    server: { version: '0.3.0', build: 'dev', latestBuild: null, updateAvailable: false, update: null, healthy: true, agentd: true, firewall: true, running: 0, total: 0 },
    tailnetUrl: null, usageData: false, publicKey: keyOf(id), relay: { key: runtime.relayKey ?? noiseKeyOf(id), computerId: createHash('sha256').update(Buffer.from(runtime.relayKey ?? noiseKeyOf(id), 'hex')).digest('hex'), url: null },
  }
}

function noiseKeyOf(id: string): string {
  return Buffer.from(id.padEnd(32, '~')).toString('hex')
}

function keyOf(id: string): string {
  return Buffer.from(id.padEnd(32, '.')).toString('base64')
}

async function putAccess({ id, runtime, list }: { id: string; runtime: Fake; list: Access }): Promise<Response> {
  const refuse = (status: number, message: string) => Response.json({ error: { type: 'invalid_request_error', message } }, { status })
  if (!await verify(list)) return refuse(400, 'Bad signature.')
  if (runtime.access && runtime.access.owner !== list.owner && id !== 'local') return refuse(403, 'Another owner.')
  if (runtime.access && runtime.access.owner === list.owner && list.version <= runtime.access.version) return refuse(409, 'Not newer.')
  runtime.access = list
  return Response.json(list)
}

function serve({ id, runtime }: { id: string; runtime: Fake }) {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    if (!runtime.up) throw new TypeError('fetch failed')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    runtime.calls.push(`${method} ${path}`)
    const list = <T>(data: T[]) => Response.json({ object: 'list', url: path, hasMore: false, data })
    if (path === '/api/agents') return list(runtime.agents)
    if (path === '/api/agents/imports') {
      const sealed = JSON.parse(body.sealed)
      if (runtime.refuseImport || sealed.for !== keyOf(id)) return Response.json({ error: { type: 'invalid_request_error', message: 'Not today.' } }, { status: 409 })
      runtime.agents.push({ ...sealed.payload, wanted: 'stopped' })
      if (runtime.downAfterImport) runtime.up = false
      return Response.json({ object: 'agent_import', agent: { ...sealed.payload, wanted: 'stopped' }, ungranted: ['GitHub'] })
    }
    const one = /^\/api\/agents\/(ag_\w+)(\/export)?$/.exec(path)
    const found = runtime.agents.find((each) => each.id === one?.[1])
    if (one && !found) return Response.json({ error: { type: 'invalid_request_error', message: 'No such agent.' } }, { status: 404 })
    if (found && one?.[2]) return Response.json({ object: 'export', sealed: JSON.stringify({ for: body.publicKey, payload: found }) })
    if (found && method === 'PATCH') return Response.json(Object.assign(found, body))
    if (found && method === 'DELETE') {
      runtime.agents = runtime.agents.filter((each) => each !== found)
      return Response.json({ id: found.id, object: 'agent', deleted: true })
    }
    if (found) return Response.json(found)
    if (path === '/api/connections') return list(runtime.connections.map(({ secret: _secret, ...each }) => each))
    if (path === '/api/providers') return list(['claude', 'codex', 'openrouter', 'openai', 'xai'].map((each) => providerOf({ id: each, runtime })))
    const provider = /^\/api\/providers\/(\w+)(\/refresh)?$/.exec(path)
    if (provider && method === 'PATCH' && body.apiKey) {
      if (body.apiKey.includes('bad')) return Response.json({ error: { type: 'invalid_request_error', message: `${provider[1]} refused that key.`, param: 'apiKey' } }, { status: 400 })
      runtime.keys[provider[1]] = body.apiKey
    }
    if (provider && method === 'DELETE') delete runtime.keys[provider[1]]
    if (provider) return Response.json(providerOf({ id: provider[1], runtime }))
    if (path === '/api/admin') return Response.json(adminOf({ id, runtime }))
    if (path === '/api/access' && method === 'PUT') return putAccess({ id, runtime, list: body })
    if (path === '/api/access') return runtime.access ? Response.json(runtime.access) : Response.json({ error: { type: 'invalid_request_error', message: 'No list yet.' } }, { status: 404 })
    if (path === '/api/me') return Response.json({ object: 'me', user: { id: 'usr_a', object: 'person', email: 'me', joinedAt: AT }, timeZone: 'UTC' })
    if (path === '/api/admin/exports') {
      const source = runtime.connections.find((each) => each.id === body.connectionId)
      const payload = body.subscription ? { type: 'claude', token: runtime.seat.token, at: runtime.seat.at } : { type: 'connection', kind: source?.kind, name: source?.name, secret: source?.secret }
      return Response.json({ object: 'export', sealed: JSON.stringify({ for: body.publicKey, payload }) })
    }
    if (path === '/api/admin/imports') {
      const sealed = JSON.parse(body.sealed)
      if (sealed.for !== keyOf(id)) return Response.json({ error: { type: 'invalid_request_error', message: 'Not sealed for this computer.' } }, { status: 400 })
      if (sealed.payload.type === 'claude') {
        runtime.seat = { token: sealed.payload.token, at: sealed.payload.at }
        return Response.json(adminOf({ id, runtime }))
      }
      const made = connection({ id: `cn_${id}_${runtime.connections.length}`, kind: sealed.payload.kind, name: sealed.payload.name, secret: sealed.payload.secret })
      runtime.connections.push(made)
      return Response.json(made)
    }
    if (path === '/api/connection-authorizations') return Response.json({ object: 'connection_authorization', kind: body.kind, authorizationUrl: `https://${id}.example/sign-in/${body.kind}` })
    if (path === '/api/grants') return Response.json({ id: 'gr_1', object: 'grant', agentId: body.agentId, connectionId: body.connectionId, createdAt: AT })
    return Response.json({ error: { type: 'invalid_request_error', message: `There's no ${method} ${path}.` } }, { status: 404 })
  }
}

const MAC = 'ab'.repeat(32)
const PHONE = 'cd'.repeat(32)
const ownerKeys = keys()

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, key: Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex') }
}

function signedBy({ by, list }: { by: { privateKey: KeyObject; key: string }; list: Omit<Unsigned, 'owner' | 'object'> }): Access {
  const unsigned: Unsigned = { object: 'access', owner: by.key, ...list }
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), by.privateKey).toString('hex') }
}

function setup(ids: string[], options: { owner?: boolean; signed?: Platform['signed'] } = {}) {
  const runtimes = Object.fromEntries(ids.map((id) => [id, fake()]))
  const opened: string[] = []
  const stored: StoredComputer[] = ids.map((id) => ({ id, name: id, url: id === 'local' ? '' : `https://${id}.example` }))
  const platform: Platform = {
    transport: (computer) => serve({ id: computer.id, runtime: runtimes[computer.id] }),
    store: {
      computers: async () => stored,
      add: async () => { throw new Error('not in this test') },
      adopt: async () => { throw new Error('not in this test') },
      remove: async () => undefined,
    },
    openUrl: (url) => { opened.push(url) },
    owner: options.owner ? async () => ({ key: ownerKeys.key, sign: async (text) => sign(null, Buffer.from(text), ownerKeys.privateKey).toString('hex'), self: { key: MAC, name: 'Mo\'s Mac' } }) : undefined,
    signed: options.signed,
  }
  return { runtimes, opened, stored, openhut: createOpenHut(platform) }
}

test('agents from every computer come back tagged; connections are merged by kind and name; an offline computer keeps its last-known rows greyed', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.agents = [agent('Ops')]
  runtimes.beelink.agents = [agent('Sales')]
  runtimes.local.connections = [connection({ id: 'cn_a', kind: 'postgres', name: 'Orders DB', secret: 'dsn' })]
  runtimes.beelink.connections = [connection({ id: 'cn_b', kind: 'postgres', name: 'Orders DB', secret: 'dsn' }), connection({ id: 'cn_c', kind: 'github', name: 'GitHub' })]
  assert.deepEqual((await openhut.agents.list()).map((each) => [each.name, each.computer, each.online]), [['Ops', 'local', true], ['Sales', 'beelink', true]])
  assert.deepEqual((await openhut.connections.list()).map((each) => [each.name, each.computers.map((where) => where.computer)]), [['Orders DB', ['local', 'beelink']], ['GitHub', ['beelink']]])
  runtimes.beelink.up = false
  assert.deepEqual((await openhut.agents.list()).map((each) => [each.name, each.online]), [['Ops', true], ['Sales', false]])
  assert.deepEqual((await openhut.computers.list()).map((each) => [each.id, each.online]), [['local', true], ['beelink', false]])
})

test('agents from a computer on an older runtime still show (old model names, no helper models)', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  const { helperModels: _helpers, ...old } = agent('Juniper')
  runtimes.beelink.agents = [{ ...old, model: 'sonnet' } as unknown as Agent]
  const [found] = await openhut.agents.list()
  assert.deepEqual([found?.name, found?.computer, found?.model, found?.helperModels], ['Juniper', 'beelink', 'claude:sonnet', { compress: null, title: null, review: null }])
})

test('a call about an agent or a connection reaches the computer it lives on, found by listing when it is new to the app', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.beelink.agents = [agent('Sales')]
  runtimes.beelink.connections = [connection({ id: 'cn_b', kind: 'github', name: 'GitHub' })]
  assert.equal((await openhut.fetch({ of: 'ag_sales', path: '/api/agents/ag_sales' })).status, 200)
  await openhut.fetch({ of: 'cn_b', path: '/api/grants' })
  await openhut.fetch({ computer: 'local', path: '/api/me' })
  assert.deepEqual([runtimes.beelink.calls.filter((call) => !call.endsWith('/api/agents') && !call.endsWith('/api/connections')), runtimes.local.calls.at(-1), openhut.agents.home('ag_sales')], [['GET /api/agents/ag_sales', 'GET /api/grants'], 'GET /api/me', 'beelink'])
})

test('adding a keyed connection to another computer moves it sealed to that computer; a sign-in connection opens its sign-in there instead', async () => {
  const { runtimes, opened, openhut } = setup(['local', 'beelink'])
  runtimes.local.connections = [connection({ id: 'cn_a', kind: 'postgres', name: 'Orders DB', secret: 'postgres://u:p@db' }), connection({ id: 'cn_g', kind: 'github', name: 'GitHub' })]
  const moved = await openhut.connections.addTo({ id: 'cn_a', computer: 'beelink' })
  assert.equal(moved.object, 'connection')
  assert.equal(runtimes.beelink.connections[0]?.secret, 'postgres://u:p@db')
  assert.deepEqual(opened, [])
  await openhut.connections.addTo({ id: 'cn_g', computer: 'beelink' })
  assert.deepEqual(opened, ['https://beelink.example/sign-in/github'])
  assert.equal(runtimes.local.calls.includes('POST /api/admin/exports'), true)
  assert.equal(runtimes.beelink.connections.length, 1)
})

test('granting a connection to an agent uses the copy on that agent\'s computer, and asks to add it first when there is none', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.beelink.agents = [agent('Growth')]
  runtimes.local.connections = [connection({ id: 'cn_a', kind: 'postgres', name: 'Orders DB', secret: 'dsn' })]
  await assert.rejects(openhut.connections.grant({ connection: 'cn_a', agent: 'ag_growth' }), /isn't on beelink yet/)
  const copy = await openhut.connections.addTo({ id: 'cn_a', computer: 'beelink' })
  const grant = await openhut.connections.grant({ connection: 'cn_a', agent: 'ag_growth' })
  assert.equal(grant.connectionId, 'id' in copy ? copy.id : '')
  assert.equal(runtimes.beelink.calls.includes('POST /api/grants'), true)
})

test('the newest Claude sign-in is pushed to every online computer, and an offline one catches up when it is back', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink', 'office'])
  runtimes.local.seat = { token: 'new', at: '2026-11-17T10:00:00.000Z' }
  runtimes.beelink.seat = { token: 'old', at: '2026-11-01T10:00:00.000Z' }
  runtimes.office.up = false
  assert.deepEqual(await openhut.account.sync(), { claude: ['office'], codex: [] })
  assert.deepEqual(runtimes.beelink.seat, { token: 'new', at: '2026-11-17T10:00:00.000Z' })
  runtimes.office.up = true
  assert.deepEqual(await openhut.account.sync(), { claude: [], codex: [] })
  assert.deepEqual(runtimes.office.seat, { token: 'new', at: '2026-11-17T10:00:00.000Z' })
  const exports = runtimes.local.calls.filter((call) => call === 'POST /api/admin/exports').length
  await openhut.account.sync()
  assert.equal(runtimes.local.calls.filter((call) => call === 'POST /api/admin/exports').length, exports)
})

test('moving an agent stops it, carries it sealed, starts it on the new computer and only then deletes the old copy', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.agents = [agent('Ops')]
  await openhut.agents.list()
  const moved = await openhut.agents.move({ id: 'ag_ops', to: 'beelink' })
  assert.deepEqual([moved.agent.computer, moved.agent.wanted, moved.ungranted], ['beelink', 'running', ['GitHub']])
  assert.deepEqual(runtimes.local.calls.filter((call) => !call.startsWith('GET')), ['PATCH /api/agents/ag_ops', 'POST /api/agents/ag_ops/export', 'DELETE /api/agents/ag_ops'])
  assert.deepEqual(runtimes.beelink.calls.filter((call) => !call.startsWith('GET')), ['POST /api/agents/imports', 'PATCH /api/agents/ag_ops'])
  assert.deepEqual([runtimes.local.agents.length, runtimes.beelink.agents[0]?.wanted], [0, 'running'])
  await assert.rejects(openhut.agents.move({ id: 'ag_ops', to: 'beelink' }), /already on beelink/)
})

test('a move that fails on the new computer starts the agent again where it was', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.agents = [agent('Ops')]
  runtimes.beelink.refuseImport = true
  await openhut.agents.list()
  await assert.rejects(openhut.agents.move({ id: 'ag_ops', to: 'beelink' }), /Not today/)
  assert.deepEqual(runtimes.local.agents.map((each) => [each.id, each.wanted]), [['ag_ops', 'running']])
  assert.equal(runtimes.beelink.agents.length, 0)
})

test('only the Claude sign-in is pushed between computers: a Codex refresh token is single use, so each computer signs in itself', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.codexAt = '2026-11-17T10:00:00.000Z'
  assert.deepEqual(await openhut.account.sync(), { claude: [], codex: [] })
  assert.equal(runtimes.local.calls.includes('POST /api/admin/exports'), false)
})

test('a move that fails after the new computer may have a copy leaves the agent stopped where it was, so it never runs twice', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.agents = [agent('Ops')]
  runtimes.beelink.downAfterImport = true
  await openhut.agents.list()
  await assert.rejects(openhut.agents.move({ id: 'ag_ops', to: 'beelink' }), /beelink may still have a copy, so local keeps it stopped/)
  assert.deepEqual(runtimes.local.agents.map((each) => [each.id, each.wanted]), [['ag_ops', 'stopped']])
})

test('an app older than a computer asks for is flagged; versions compare part by part', async () => {
  const { older } = await import('../src/openhut.ts')
  assert.deepEqual([older({ version: '0.1.9', than: '0.1.10' }), older({ version: '0.2.0', than: '0.1.10' }), older({ version: '0.1.0', than: '0.1.0' }), older({ version: 'dev', than: '0.1.0' })], [true, false, false, false])
})

test('a key is put on the computers that were ticked and nowhere else, and the first refusal stops the rest', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink', 'office'])
  await openhut.providers.connect({ id: 'openai', apiKey: 'sk-one-key', computers: ['local', 'office'] })
  assert.deepEqual(Object.values(runtimes).map((each) => each.keys.openai), ['sk-one-key', undefined, 'sk-one-key'])
  await assert.rejects(openhut.providers.connect({ id: 'xai', apiKey: 'xai-bad-key', computers: ['beelink', 'local'] }), /refused that key/)
  assert.deepEqual(Object.values(runtimes).map((each) => each.keys.xai), [undefined, undefined, undefined])
  runtimes.office.up = false
  await assert.rejects(openhut.providers.connect({ id: 'xai', apiKey: 'xai-good-key', computers: ['local', 'office'] }), /office/)
  assert.equal(runtimes.local.keys.xai, 'xai-good-key')
  await assert.rejects(openhut.providers.connect({ id: 'xai', apiKey: 'xai-good-key', computers: [] }), /at least one computer/)
})

test('refresh, switches and disconnect reach every online computer that holds the provider, and only those', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink', 'office'])
  runtimes.local.keys.openrouter = 'sk-or-1'
  runtimes.office.keys.openrouter = 'sk-or-1'
  await openhut.providers.refresh('openrouter')
  await openhut.providers.setModels({ id: 'openrouter', models: [{ id: 'm1', on: false }] })
  const touched = (name: string) => runtimes[name].calls.filter((call) => /providers\/openrouter/.test(call) && call !== 'GET /api/providers')
  assert.deepEqual(touched('local'), ['POST /api/providers/openrouter/refresh', 'PATCH /api/providers/openrouter'])
  assert.deepEqual(touched('beelink'), [])
  await openhut.providers.disconnect('openrouter')
  assert.deepEqual([runtimes.local.keys.openrouter, runtimes.office.keys.openrouter], [undefined, undefined])
})

test('Settings sees one row per provider: the computers that hold it, and the first holder\'s models and key', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.beelink.keys.openai = 'sk-bee-1'
  runtimes.local.keys.openai = 'sk-loc-1'
  const merged = mergeProviders(await openhut.providers.list())
  assert.deepEqual(merged.map((each) => each.id), ['claude', 'codex', 'openrouter', 'openai', 'xai'])
  const openai = merged.find((each) => each.id === 'openai')
  assert.deepEqual([openai?.computers, openai?.keyHint], [['local', 'beelink'], 'sk-…'])
  assert.deepEqual(merged.find((each) => each.id === 'xai')?.computers, [])
  runtimes.local.up = false
  assert.deepEqual(mergeProviders(await openhut.providers.list()).find((each) => each.id === 'openai')?.computers, ['beelink'])
})

test('with no list anywhere the Mac app signs version 1, with itself as the only client and every computer it reaches, and puts it on each', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'], { owner: true })
  const list = await openhut.access.sync()
  assert.equal(list?.version, 1)
  assert.deepEqual(list?.clients.map((each) => [each.key, each.name]), [[MAC, 'Mo\'s Mac']])
  assert.deepEqual(list?.computers.map((each) => each.name), ['local', 'beelink'])
  assert.deepEqual(list?.computers.map((each) => [each.key, each.id]), ['local', 'beelink'].map((id) => [noiseKeyOf(id), createHash('sha256').update(Buffer.from(noiseKeyOf(id), 'hex')).digest('hex')]))
  assert.ok(list && await verify(list))
  assert.deepEqual([runtimes.local.access, runtimes.beelink.access], [list, list])
  await openhut.access.sync()
  assert.deepEqual([runtimes.local.access?.version, runtimes.beelink.access?.version], [1, 1])
})

test('a computer that was offline gets the newer list on the next sync, and a removed device stays removed', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'], { owner: true })
  const first = await openhut.access.sync()
  const withPhone = signedBy({ by: ownerKeys, list: { ...first!, version: 2, clients: [...first!.clients, { key: PHONE, name: 'Mo\'s iPhone', addedAt: AT }] } })
  runtimes.local.access = withPhone
  runtimes.beelink.access = withPhone
  assert.deepEqual((await openhut.access.list()).map((each) => [each.name, each.self]), [['Mo\'s Mac', true], ['Mo\'s iPhone', false]])
  runtimes.beelink.up = false
  assert.deepEqual((await openhut.access.remove(PHONE)).map((each) => each.key), [MAC])
  assert.equal(runtimes.local.access?.version, 3)
  assert.equal(runtimes.beelink.access?.version, 2)
  runtimes.beelink.up = true
  await openhut.access.sync()
  assert.equal(runtimes.beelink.access?.version, 3)
  assert.deepEqual(runtimes.beelink.access?.clients.map((each) => each.key), [MAC])
})

test('sync never sends an older list: a computer ahead is left alone and the others catch up to it', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'], { owner: true })
  const first = await openhut.access.sync()
  runtimes.beelink.access = signedBy({ by: ownerKeys, list: { ...first!, version: 5 } })
  runtimes.beelink.calls = []
  await openhut.access.sync()
  assert.deepEqual(runtimes.beelink.calls.filter((call) => call.startsWith('PUT')), [])
  assert.equal(runtimes.local.access?.version, 5)
})

test('a list signed by another owner is never carried, even to the computer that takes a new owner from its socket', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'], { owner: true })
  runtimes.beelink.access = signedBy({ by: keys(), list: { version: 9, clients: [{ key: PHONE, name: 'Not yours', addedAt: AT }], computers: [] } })
  await openhut.access.sync()
  assert.equal(runtimes.local.access?.owner, ownerKeys.key)
  assert.deepEqual(runtimes.local.access?.clients.map((each) => each.key), [MAC])
  assert.equal(runtimes.beelink.access?.version, 9)
})

test('only the app that holds the owner key removes devices, and never itself', async () => {
  const { openhut } = setup(['local'])
  await assert.rejects(openhut.access.remove(PHONE), /Open the OpenHut app on your Mac/)
  assert.equal(await openhut.access.sync(), undefined)
  const { openhut: mac } = setup(['local'], { owner: true })
  await assert.rejects(mac.access.remove(MAC), /can't remove itself/)
})

test('allowing a phone signs exactly one new version with it as a client, carried to every computer', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'], { owner: true })
  const first = await openhut.access.sync()
  const next = await openhut.access.allow({ name: 'Mo\'s iPhone', kind: 'client', key: PHONE })
  assert.equal(next.version, first!.version + 1)
  assert.ok(await verify(next))
  assert.deepEqual(next.clients.map((each) => [each.key, each.name]), [[MAC, 'Mo\'s Mac'], [PHONE, 'Mo\'s iPhone']])
  assert.deepEqual(next.computers, first!.computers)
  assert.deepEqual([runtimes.local.access, runtimes.beelink.access], [next, next])
  await openhut.access.sync()
  assert.equal((await openhut.access.allow({ name: 'Mo\'s iPhone', kind: 'client', key: PHONE })).version, next.version)
  assert.deepEqual([runtimes.local.access?.version, runtimes.beelink.access?.version], [next.version, next.version])
})

test('allowing a computer adds it to the list\'s computers by its relay key, and a sync while it is still joining keeps it', async () => {
  const { runtimes, openhut, stored } = setup(['local'], { owner: true })
  await openhut.access.sync()
  const key = 'ef'.repeat(32)
  stored.push({ id: 'office', name: 'Office server', url: '' })
  runtimes.office = { ...fake(), up: false }
  const next = await openhut.access.allow({ name: 'Office server', kind: 'computer', key })
  assert.equal(next.version, 2)
  assert.deepEqual(next.computers.at(-1), { id: createHash('sha256').update(Buffer.from(key, 'hex')).digest('hex'), name: 'Office server', key })
  assert.deepEqual(next.clients.map((each) => each.key), [MAC])
  assert.equal((await openhut.access.sync())?.version, 2)
})

test('syncs asked while one is running share it, so polling can\'t pile them up ahead of Allow when a computer is slow', async () => {
  const { runtimes, openhut } = setup(['local', 'office'], { owner: true })
  await openhut.access.sync()
  runtimes.office.calls.length = 0
  const lists = await Promise.all([1, 2, 3, 4, 5].map(() => openhut.access.sync()))
  assert.equal(runtimes.office.calls.filter((each) => each === 'GET /api/access').length, 1)
  assert.equal(new Set(lists.map((each) => each?.version)).size, 1)
  await openhut.access.sync()
  assert.equal(runtimes.office.calls.filter((each) => each === 'GET /api/access').length, 2)
})

test('a computer that has a relay key is listed by it, not by its transfer key', async () => {
  const { runtimes, openhut } = setup(['local'], { owner: true })
  runtimes.local.relayKey = '12'.repeat(32)
  const list = await openhut.access.sync()
  assert.deepEqual(list?.computers.map((each) => each.key), ['12'.repeat(32)])
})

test('a phone carries the newest owner-signed list it has to computers that are behind, keeps a newer one it sees, and never carries a foreign one', async () => {
  let held: Access | undefined = signedBy({ by: ownerKeys, list: { version: 4, clients: [{ key: PHONE, name: 'Mo\'s iPhone', addedAt: AT }], computers: [] } })
  const { runtimes, openhut } = setup(['local', 'beelink', 'other'], { signed: { read: async () => held, save: async (list) => { held = list } } })
  runtimes.local.access = signedBy({ by: ownerKeys, list: { ...held, version: 2 } })
  runtimes.beelink.access = signedBy({ by: ownerKeys, list: { ...held, version: 6 } })
  runtimes.other.access = signedBy({ by: keys(), list: { version: 9, clients: [], computers: [] } })
  const carried = await openhut.access.sync()
  assert.equal(carried?.version, 6)
  assert.equal(held?.version, 6)
  assert.deepEqual([runtimes.local.access?.version, runtimes.beelink.access?.version], [6, 6])
  assert.equal(runtimes.other.access?.version, 9)
  held = { ...held!, version: 7 }
  runtimes.local.calls = []
  assert.equal((await openhut.access.sync())?.version, 6)
  assert.deepEqual(runtimes.local.calls.filter((call) => call.startsWith('PUT')), [])
})

test('who you are comes from the first computer that answers, so a phone still opens with its first computer off', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.up = false
  assert.equal((await openhut.account.me()).user.id, 'usr_a')
  assert.deepEqual(runtimes.beelink.calls, ['GET /api/me'])
  runtimes.beelink.up = false
  await assert.rejects(openhut.account.me(), /fetch failed/)
})
