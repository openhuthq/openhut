import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../src/app.ts'

const KEY = { authorization: 'Bearer test-publish-key' }
const checkIn = (installId: string) => app.inject({ method: 'POST', url: '/api/check-ins', payload: { installId, build: '20261113000001', version: '0.1.0' } })

test('only the publish key lists installs', async () => {
  await checkIn('a'.repeat(32))
  assert.equal((await app.inject({ url: '/api/installs' })).statusCode, 401)
  const list = (await app.inject({ url: '/api/installs', headers: KEY })).json()
  assert.deepEqual([list.object, list.url, list.hasMore], ['list', '/api/installs', false])
  assert.deepEqual(list.data.map((install: { object: string; id: string; build: string }) => [install.object, install.id, install.build]), [['install', 'a'.repeat(32), '20261113000001']])
})

test('installs page newest first, and both cursors at once are refused', async () => {
  await checkIn('b'.repeat(32))
  const first = (await app.inject({ url: '/api/installs?limit=1', headers: KEY })).json()
  assert.deepEqual([first.data[0].id, first.hasMore], ['b'.repeat(32), true])
  const both = await app.inject({ url: `/api/installs?startingAfter=${'b'.repeat(32)}&endingBefore=${'a'.repeat(32)}`, headers: KEY })
  assert.equal(both.statusCode, 400)
  assert.equal(both.json().error.param, 'endingBefore')
})
