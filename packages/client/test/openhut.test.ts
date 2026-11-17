import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Admin } from '@openhut/common/admin/admin.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Connection, ConnectionKind } from '@openhut/common/connections/connection.ts'
import { createOpenHut, type Platform, type StoredComputer } from '../src/openhut.ts'

const AT = '2026-11-17T00:00:00.000Z'

type Fake = {
  up: boolean
  refuseImport?: boolean
  codexAt?: string
  agents: Agent[]
  connections: (Connection & { secret?: string })[]
  seat: { at: string | null; token: string }
  calls: string[]
}

function fake(): Fake {
  return { up: true, agents: [], connections: [], seat: { at: null, token: '' }, calls: [] }
}

function agent(name: string): Agent {
  return { id: `ag_${name.toLowerCase()}`, object: 'agent', name, ownerId: 'usr_a', ownerName: 'me', model: 'sonnet', wanted: 'running', status: 'running', health: 'answering', healthDetail: '', summary: '', net: 0, instructions: '', codeExecution: false, browser: false, canEdit: true, createdAt: AT }
}

function connection({ id, kind, name, secret }: { id: string; kind: ConnectionKind; name: string; secret?: string }): Connection & { secret?: string } {
  return { id, object: 'connection', kind, name, account: '', signIn: !secret, ownerId: 'usr_a', ownerName: 'me', everyone: false, usable: true, canDelete: true, agents: 0, status: 'connected', lastSuccessAt: null, createdAt: AT, secret }
}

function adminOf({ id, runtime }: { id: string; runtime: Fake }): Admin {
  return {
    object: 'admin', seat: { set: !!runtime.seat.token, mode: 'claude', updatedAt: runtime.seat.at }, codex: { set: !!runtime.codexAt, updatedAt: runtime.codexAt ?? null },
    server: { version: '0.3.0', build: 'dev', latestBuild: null, updateAvailable: false, update: null, healthy: true, agentd: true, firewall: true, running: 0, total: 0 },
    tailnetUrl: null, google: { clientId: null, redirectUri: '' }, usageData: false, publicKey: `key-of-${id}`,
  }
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
      if (runtime.refuseImport || sealed.for !== `key-of-${id}`) return Response.json({ error: { type: 'invalid_request_error', message: 'Not today.' } }, { status: 409 })
      runtime.agents.push({ ...sealed.payload, wanted: 'stopped' })
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
    if (path === '/api/admin') return Response.json(adminOf({ id, runtime }))
    if (path === '/api/me') return Response.json({ object: 'me', user: { id: 'usr_a', object: 'person', email: 'me', joinedAt: AT }, timeZone: 'UTC' })
    if (path === '/api/admin/exports') {
      const source = runtime.connections.find((each) => each.id === body.connectionId)
      const payload = body.subscription ? { type: 'claude', token: runtime.seat.token, at: runtime.seat.at } : { type: 'connection', kind: source?.kind, name: source?.name, secret: source?.secret }
      return Response.json({ object: 'export', sealed: JSON.stringify({ for: body.publicKey, payload }) })
    }
    if (path === '/api/admin/imports') {
      const sealed = JSON.parse(body.sealed)
      if (sealed.for !== `key-of-${id}`) return Response.json({ error: { type: 'invalid_request_error', message: 'Not sealed for this computer.' } }, { status: 400 })
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

function setup(ids: string[]) {
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
  }
  return { runtimes, opened, openhut: createOpenHut(platform) }
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

test('only the Claude sign-in is pushed while Codex is coming soon', async () => {
  const { runtimes, openhut } = setup(['local', 'beelink'])
  runtimes.local.codexAt = '2026-11-17T10:00:00.000Z'
  assert.deepEqual(await openhut.account.sync(), { claude: [], codex: [] })
  assert.equal(runtimes.local.calls.includes('POST /api/admin/exports'), false)
})
