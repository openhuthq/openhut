import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { adminService, isNewer, updateStatus } from '../../../src/server/admin/admin-service.ts'
import { connectionService } from '../../../src/server/connections/connection-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { settings } from '../../../src/server/platform/settings.ts'

const actor = { id: 'usr_aaaaaaaa', email: 'owner@example.com', local: false }
await migrate()
await db.insertInto('person').values({ id: actor.id, email: actor.email, role: 'owner' }).execute()
const startedAt = '2026-11-13T12:00:00.000Z'
const at = (seconds: number) => Date.parse(startedAt) + seconds * 1000

test('a server install reads the latest release from the site; a desktop install never does', async (t) => {
  const site = createServer((_req, res) => res.end('#!/bin/sh\nOPENHUT_BUILD="9.9.9"\n')).listen(0, '127.0.0.1')
  await once(site, 'listening')
  const { releaseUrl, installKind } = config
  t.after(() => { site.close(); Object.assign(config, { releaseUrl, installKind }) })
  config.releaseUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  assert.equal(config.installKind, 'server')
  assert.equal(await adminService.latestBuild(), '9.9.9')
  config.installKind = 'mac'
  assert.equal(await adminService.latestBuild(), null)
})

test('a higher version is an update, and so is any other release that is not a version; never for a dev build', () => {
  assert.equal(isNewer({ latest: '0.1.10', current: '0.1.9' }), true)
  assert.equal(isNewer({ latest: '0.2.0', current: '0.1.40' }), true)
  assert.equal(isNewer({ latest: '0.1.9', current: '0.1.10' }), false)
  assert.equal(isNewer({ latest: '0.1.9', current: '0.1.9' }), false)
  assert.equal(isNewer({ latest: '0.1.40', current: '20261113130239' }), true)
  assert.equal(isNewer({ latest: 'e2e-2', current: 'e2e-1' }), true)
  assert.equal(isNewer({ latest: '0.1.40', current: 'dev' }), false)
  assert.equal(isNewer({ latest: null, current: '0.1.40' }), false)
})

test('an update is running while the installer holds the lock, done only on the build it asked for, failed with the installer\'s reason otherwise', () => {
  const startedAt = '2026-11-13T00:00:00.000Z'
  const stored = { from: 'a', to: 'b', startedAt }
  const at = (seconds: number) => Date.parse(startedAt) + seconds * 1000
  const last = (seconds: number, reason: string | null, exit = 1) => ({ exit, at: new Date(at(seconds)).toISOString(), reason })
  assert.deepEqual(updateStatus({ stored, build: 'a', installing: false, now: at(5) }), { status: 'running', reason: null })
  assert.deepEqual(updateStatus({ stored, build: 'a', installing: true, now: at(120) }), { status: 'running', reason: null })
  assert.deepEqual(updateStatus({ stored, build: 'b', installing: true, now: at(30) }), { status: 'done', reason: null })
  assert.deepEqual(updateStatus({ stored, build: 'c', installing: false, now: at(30) }), { status: 'failed', reason: 'It installed c instead of b.' })
  assert.equal(updateStatus({ stored, build: 'a', installing: false, now: at(30) }).status, 'failed')
  assert.equal(updateStatus({ stored, build: 'a', installing: true, now: at(46 * 60) }).status, 'failed')
  assert.deepEqual(updateStatus({ stored, build: 'a', installing: false, last: last(10, 'the new release didn\'t come up, so the previous one is running again'), now: at(12) }),
    { status: 'failed', reason: 'the new release didn\'t come up, so the previous one is running again' })
  assert.deepEqual(updateStatus({ stored, build: 'a', installing: false, last: last(-60, 'an older failure'), now: at(5) }), { status: 'running', reason: null })
})

test('a keyed connection and a subscription travel sealed to a public key, keeping when the subscription was signed in', async () => {
  const { publicKey } = await adminService.status()
  const source = await connectionService.save({ actor, kind: 'postgres', name: 'Orders DB', config: { dsn: 'postgres://u:p@db/orders' }, account: 'db/orders', signIn: false })
  const { sealed } = await adminService.exportSealed({ actor, publicKey, connectionId: source.id })
  assert.equal(sealed.includes('postgres://'), false)
  const copy = await adminService.importSealed({ actor, sealed })
  assert.equal(copy.object === 'connection' && copy.name, 'Orders DB')
  assert.notEqual(copy.object === 'connection' && copy.id, source.id)
  await settings.setSeatToken('sk-ant-oat01-the-seat-token-for-this-test')
  await settings.setSeatAt('2026-11-01T00:00:00.000Z')
  const seat = await adminService.exportSealed({ actor, publicKey, subscription: 'claude' })
  await settings.setSeatAt('2026-11-02T00:00:00.000Z')
  const admin = await adminService.importSealed({ actor, sealed: seat.sealed })
  assert.equal(admin.object === 'admin' && admin.seat.updatedAt, '2026-11-01T00:00:00.000Z')
})

test('a sign-in connection is never exported, and a box sealed for another computer is refused', async () => {
  const { publicKey } = await adminService.status()
  const signedIn = await connectionService.save({ actor, kind: 'github', name: 'GitHub', config: {}, account: 'acme', signIn: true })
  await assert.rejects(adminService.exportSealed({ actor, publicKey, connectionId: signedIn.id }), /sign-in/)
  const other = generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const { sealed } = await adminService.exportSealed({ actor, publicKey: other, subscription: 'claude' })
  await assert.rejects(adminService.importSealed({ actor, sealed }), /sealed for this computer/)
})
