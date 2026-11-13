import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../src/app.ts'

const KEY = { authorization: 'Bearer test-publish-key' }
const register = ({ build, version = '0.1.0', headers = KEY }: { build: string; version?: string; headers?: Record<string, string> }) =>
  app.inject({ method: 'POST', url: '/api/releases', headers, payload: { build, version, sha256: 'a'.repeat(64), url: 'https://get.jakebox.dev/jakebox.tgz', notes: 'First one' } })

test('latest is a 404 with a sentence before any release is registered', async () => {
  const res = await app.inject({ url: '/api/releases/latest' })
  assert.equal(res.statusCode, 404)
  assert.match(res.json().error.message, /^No release is registered yet\./)
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
  const res = await app.inject({ method: 'POST', url: '/api/releases', headers: KEY, payload: { build: 'b', version: 'one', sha256: 'x', url: 'https://x.test' } })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.param, 'version')
})

test('latest is public and is the newest release', async () => {
  await register({ build: '20261113000002', version: '0.2.0' })
  const res = await app.inject({ url: '/api/releases/latest' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual([res.json().build, res.json().version], ['20261113000002', '0.2.0'])
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
})
