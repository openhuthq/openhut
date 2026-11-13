import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../src/app.ts'
import { db } from '../../src/platform/db.ts'

const INSTALL_ID = 'i'.repeat(32)
const checkIn = ({ installId = INSTALL_ID, build }: { installId?: string; build: string }) =>
  app.inject({ method: 'POST', url: '/api/installs', payload: { installId, build, version: '0.1.0' } })

test('a check-in registers the install, and only the publish key lists installs', async () => {
  const res = await checkIn({ build: 'b1' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual([res.json().object, res.json().id, res.json().build], ['install', INSTALL_ID, 'b1'])
  assert.equal((await app.inject({ url: '/api/installs' })).statusCode, 401)
  const list = (await app.inject({ url: '/api/installs', headers: { authorization: 'Bearer test-publish-key' } })).json()
  assert.deepEqual(list.data.map((install: { id: string; build: string }) => [install.id, install.build]), [[INSTALL_ID, 'b1']])
})

test('an install checks in at most once a minute', async () => {
  const early = await checkIn({ build: 'b2' })
  assert.equal(early.statusCode, 429)
  assert.match(early.json().error.message, /Check again in a minute\./)
  await db.updateTable('install').set({ last_check_in_at: new Date(Date.now() - 61_000) }).where('id', '=', INSTALL_ID).execute()
  const later = await checkIn({ build: 'b2' })
  assert.equal(later.statusCode, 200)
  assert.equal(later.json().build, 'b2')
})

test('an installId shorter than 32 characters is refused', async () => {
  const res = await checkIn({ installId: 'short', build: 'b1' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.param, 'installId')
})
