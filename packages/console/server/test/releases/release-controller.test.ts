import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../src/app.ts'

const KEY = { authorization: 'Bearer test-publish-key' }
const register = ({ build, version = '0.1.0', headers = KEY }: { build: string; version?: string; headers?: Record<string, string> }) =>
  app.inject({ method: 'POST', url: '/api/releases', headers, payload: { build, version, sha256: 'a'.repeat(64), url: 'https://get.jakebox.dev/jakebox.tgz', notes: 'First one' } })

test('the list is empty before any release is registered', async () => {
  const res = await app.inject({ url: '/api/releases?limit=1' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { object: 'list', url: '/api/releases', hasMore: false, data: [] })
})

test('registering a release needs the publish key', async () => {
  assert.equal((await register({ build: '20261113000001', headers: {} })).statusCode, 401)
  assert.equal((await register({ build: '20261113000001', headers: { authorization: 'Bearer test-publish-kez' } })).statusCode, 401)
  const res = await register({ build: '20261113000001' })
  assert.equal(res.statusCode, 200)
  const release = res.json()
  assert.match(release.id, /^rel_[a-f0-9]{16}$/)
  assert.deepEqual({ ...release, id: undefined, createdAt: undefined }, {
    id: undefined, object: 'release', build: '20261113000001', version: '0.1.0', sha256: 'a'.repeat(64),
    url: 'https://get.jakebox.dev/jakebox.tgz', notes: 'First one', createdAt: undefined,
  })
})

test('a build registered twice is a 409', async () => {
  const res = await register({ build: '20261113000001', version: '0.1.1' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.param, 'build')
})

test('a malformed release is a 400 that names the field', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/releases', headers: KEY, payload: { build: '20261113000009', version: 'one', sha256: 'x', url: 'https://x.test' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.param, 'version')
})

test('the list is public and newest first, so limit=1 is the latest release', async () => {
  await register({ build: '20261113000002', version: '0.2.0' })
  const res = await app.inject({ url: '/api/releases?limit=1' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().data.map((release: { build: string; version: string }) => [release.build, release.version]), [['20261113000002', '0.2.0']])
})

test('the list is newest first and pages with startingAfter', async () => {
  await register({ build: '20261113000003', version: '0.3.0' })
  const first = (await app.inject({ url: '/api/releases?limit=2' })).json()
  assert.equal(first.object, 'list')
  assert.equal(first.url, '/api/releases')
  assert.equal(first.hasMore, true)
  assert.deepEqual(first.data.map((release: { build: string }) => release.build), ['20261113000003', '20261113000002'])
  const next = (await app.inject({ url: `/api/releases?limit=2&startingAfter=${first.data[1].id}` })).json()
  assert.equal(next.hasMore, false)
  assert.deepEqual(next.data.map((release: { build: string }) => release.build), ['20261113000001'])
  const back = (await app.inject({ url: `/api/releases?limit=2&endingBefore=${next.data[0].id}` })).json()
  assert.deepEqual(back.data.map((release: { build: string }) => release.build), ['20261113000003', '20261113000002'])
})

test('an unknown cursor is a 400 that names it', async () => {
  const res = await app.inject({ url: '/api/releases?startingAfter=rel_missing' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.param, 'startingAfter')
})

test('the list shows 10 releases unless a limit is given', async () => {
  for (let n = 4; n <= 12; n += 1) await register({ build: `202611130000${String(n).padStart(2, '0')}` })
  const res = (await app.inject({ url: '/api/releases' })).json()
  assert.equal(res.data.length, 10)
  assert.equal(res.hasMore, true)
})
