import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { appRows, byName, chipMarks, connectionBrand, INTEGRATIONS, kindNote, SHELVES, uniqueName } from '../../../src/features/connections/catalog.ts'

test('a new connection takes the service name, numbered when that name is taken', () => {
  assert.equal(uniqueName({ title: 'Linear', taken: [] }), 'Linear')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear'] }), 'Linear 2')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear', 'Linear 2'] }), 'Linear 3')
})

test('every app in Connect apps has a one-line noun description with no full stop', () => {
  for (const item of SHELVES.flatMap((shelf) => shelf.items)) {
    assert.ok(item.short.length <= 38, `${item.title}: "${item.short}" is too long for one line`)
    assert.ok(!item.short.endsWith('.'), `${item.title}: "${item.short}" ends with a full stop`)
    assert.ok(!item.short.includes('as you'), `${item.title}: "${item.short}" says "as you"`)
  }
})

const connection = (extra: Partial<Connection>): Connection => ({ id: 'cn_x', object: 'connection', kind: 'postgres', name: 'Postgres', account: '', signIn: false, ownerId: 'p', ownerName: 'p', canDelete: true, agents: 1, status: 'connected', lastSuccessAt: null, createdAt: '2026-11-26T10:00:00.000Z', ...extra })
const DO = connection({ id: 'cn_do', kind: 'mcp', name: 'DigitalOcean', account: 'mcp.digitalocean.com · 3 tools' })

test('Settings › Apps is one alphabetical list: an app connected twice shows twice, a remote MCP under its own name and logo', () => {
  const before = appRows({ items: INTEGRATIONS, connections: [] }).map((row) => row.title)
  const rows = appRows({ items: INTEGRATIONS, connections: [connection({ id: 'cn_gh', kind: 'github', name: 'GitHub' }), connection({ id: 'cn_l1', kind: 'linear', name: 'Linear' }), connection({ id: 'cn_l2', kind: 'linear', name: 'Linear 2', status: 'failing' }), DO] })
  assert.deepEqual(before, byName(before, (title) => title))
  assert.deepEqual(rows.map((row) => row.title), byName(rows, (row) => row.title).map((row) => row.title))
  assert.deepEqual(rows.filter((row) => row.title.startsWith('Linear')).map((row) => [row.connection?.id, row.connection?.status]), [['cn_l1', 'connected'], ['cn_l2', 'failing']])
  assert.deepEqual(rows.filter((row) => row.title === 'GitHub').map((row) => row.connection?.id), ['cn_gh'])
  const digitalocean = rows.find((row) => row.title === 'DigitalOcean')
  assert.deepEqual([digitalocean?.brand, digitalocean?.note], ['digitalocean', 'mcp.digitalocean.com · 3 tools'])
  assert.equal(rows.find((row) => row.key === 'mcp')?.connection, undefined)
  assert.equal(digitalocean?.href, '/connections/cn_do')
  assert.equal(rows.find((row) => row.key === 'mcp')?.href, undefined)
})

test('a proposed app keeps its logo by name even on an unknown host, and only plain MCP servers say Custom MCP', () => {
  assert.equal(connectionBrand(connection({ kind: 'mcp', name: 'DigitalOcean', account: 'api.example.com · 3 tools' })), 'digitalocean')
  assert.equal(connectionBrand(connection({ kind: 'mcp', name: 'Mine', account: 'mcp.example.com · 2 tools' })), 'mcp')
  assert.equal(kindNote(DO), 'mcp.digitalocean.com · 3 tools')
  assert.equal(kindNote(connection({ kind: 'mcp', name: 'Mine', account: 'mcp.example.com' })), 'Custom MCP · mcp.example.com')
})

test('names sort without caring about case', () => {
  assert.deepEqual(byName(['postgres', 'Linear', 'DigitalOcean'], (name) => name), ['DigitalOcean', 'Linear', 'postgres'])
})

test('the sidebar chip shows only connected apps: none with nothing connected, at most 3 then +N', () => {
  assert.deepEqual(chipMarks([]), { shown: [], more: 0 })
  assert.deepEqual(chipMarks(['gmail', 'gmail', 'drive']), { shown: ['gmail', 'drive'], more: 0 })
  assert.deepEqual(chipMarks(['gmail', 'drive', 'github', 'linear', 'postgres']), { shown: ['gmail', 'drive', 'github'], more: 2 })
})
