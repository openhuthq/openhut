import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../src/app.ts'
import { db } from '../../src/platform/db.ts'

const INSTALL_ID = 'i'.repeat(32)
const checkIn = ({ installId = INSTALL_ID, build }: { installId?: string; build: string }) =>
  app.inject({ method: 'POST', url: '/api/check-ins', payload: { installId, build, version: '0.1.0' } })

test('a check-in answers with the check-in and needs no key', async () => {
  const res = await checkIn({ build: 'b1' })
  assert.equal(res.statusCode, 200)
  const { createdAt, ...rest } = res.json()
  assert.match(createdAt, /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual(rest, { object: 'check_in', installId: INSTALL_ID, build: 'b1', version: '0.1.0' })
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
