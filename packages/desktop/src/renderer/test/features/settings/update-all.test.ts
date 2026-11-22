import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Admin, Update } from '@openhut/common/admin/admin.ts'
import { behind, updateServers, type Behind } from '../../../src/features/settings/update-all.ts'

const admin = (server: Partial<Admin['server']>) => ({ server: { build: '0.2.0', updateAvailable: false, update: null, ...server } }) as unknown as Admin
const started = (to: string): Update => ({ object: 'update', status: 'running', from: '0.2.0', to, startedAt: '2026-11-18T00:00:00.000Z' })

test('only online servers with an update are behind; this Mac updates with the app, a Linux desktop\'s Docker runtime like a server', () => {
  const computers = [{ id: 'local', name: 'This Mac', url: '', online: true }, { id: 'a', name: 'beelink', url: 'https://beelink.ts.net', online: true }, { id: 'b', name: 'nuc', url: 'https://nuc.ts.net', online: false }, { id: 'c', name: 'pi', url: 'https://pi.ts.net', online: true }]
  const admins = [
    { computer: { id: 'local' }, admin: admin({ updateAvailable: true }) },
    { computer: { id: 'a' }, admin: admin({ updateAvailable: true }) },
    { computer: { id: 'b' }, admin: admin({ updateAvailable: true }) },
    { computer: { id: 'c' }, admin: admin({}) },
  ]
  assert.deepEqual(behind({ computers, admins }), [{ id: 'a', name: 'beelink' }])
  const linux = computers.map((each) => each.id === 'local' ? { ...each, name: 'This computer', url: 'http://127.0.0.1:8787' } : each)
  assert.deepEqual(behind({ computers: linux, admins }), [{ id: 'local', name: 'This computer' }, { id: 'a', name: 'beelink' }])
})

test('servers update one at a time; one that fails says why and the next still updates', async () => {
  const servers: Behind[] = [{ id: 'a', name: 'beelink' }, { id: 'b', name: 'nuc' }]
  const replies: Record<string, (Admin | undefined)[]> = {
    a: [undefined, admin({ build: '0.2.0', update: { ...started('0.2.1'), status: 'running' } }), admin({ build: '0.2.0', update: { ...started('0.2.1'), status: 'failed', reason: 'the new release didn\'t come up, so the previous one is running again' } })],
    b: [undefined, admin({ build: '0.2.1' })],
  }
  const said: string[] = []
  const order: string[] = []
  const outcomes = await updateServers({
    servers,
    steps: {
      start: async (server) => { order.push(`start ${server.id}`); return started('0.2.1') },
      read: async (server) => replies[server.id].shift(),
      say: (text) => said.push(text),
      wait: async () => undefined,
      limit: 10,
    },
  })
  assert.deepEqual(order, ['start a', 'start b'])
  assert.deepEqual(said, ['Updating beelink…', 'Updating nuc…'])
  assert.deepEqual(outcomes, [
    { id: 'a', name: 'beelink', ok: false, reason: 'the new release didn\'t come up, so the previous one is running again' },
    { id: 'b', name: 'nuc', ok: true, reason: null },
  ])
})

test('a server that refuses to start an update, or never finishes, is reported and not waited on forever', async () => {
  const outcomes = await updateServers({
    servers: [{ id: 'a', name: 'beelink' }, { id: 'b', name: 'nuc' }],
    steps: {
      start: async (server) => { if (server.id === 'a') throw new Error('An update is already running.'); return started('0.2.1') },
      read: async () => admin({ build: '0.2.0', update: started('0.2.1') }),
      say: () => undefined,
      wait: async () => undefined,
      limit: 3,
    },
  })
  assert.deepEqual(outcomes.map((each) => [each.id, each.ok, each.reason]), [
    ['a', false, 'An update is already running.'],
    ['b', false, 'It didn\'t finish in time. Settings › Computers shows when it does.'],
  ])
})
