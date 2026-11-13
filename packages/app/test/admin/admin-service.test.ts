import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const HOUR_MS = 60 * 60_000
const RUNNING = '20261113000001'
const checkIns: { installId: string; build: string; version: string }[] = []
let latest: { status: number; build?: string; version?: string } = { status: 500 }
let latestCalls = 0

const fakeConsole = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url === '/api/check-ins') {
      checkIns.push(JSON.parse(body))
      return res.end('{}')
    }
    assert.equal(req.url, '/api/releases?limit=1')
    latestCalls += 1
    res.statusCode = latest.status
    const release = { id: 'rel_1', object: 'release', build: latest.build, version: latest.version, sha256: 'a'.repeat(64), url: 'https://get.jakebox.dev/jakebox.tgz', notes: '', createdAt: new Date().toISOString() }
    res.end(JSON.stringify({ object: 'list', url: '/api/releases', hasMore: false, data: [release] }))
  })
})
await new Promise<void>((resolve) => fakeConsole.listen(0, '127.0.0.1', resolve))
const address = fakeConsole.address()
assert.ok(typeof address === 'object' && address !== null)
process.env.CONSOLE_URL = `http://127.0.0.1:${address.port}/`

const { migrate } = await import('../../src/platform/db.ts')
const { config } = await import('../../src/platform/config.ts')
const { adminService } = await import('../../src/admin/admin-service.ts')
await migrate()
config.build = RUNNING
mock.timers.enable({ apis: ['Date'], now: Date.now() })

const nextCheck = async (release: typeof latest) => {
  latest = release
  mock.timers.tick(HOUR_MS)
  return (await adminService.status()).update
}

test('a failing console means no update, and the install still checks in', async () => {
  assert.equal((await adminService.status()).update, null)
  assert.equal(checkIns.length, 1)
  assert.match(checkIns[0].installId, /^[\w-]{32,}$/)
  assert.deepEqual([checkIns[0].build, checkIns[0].version], [RUNNING, config.version])
})

test('the console is asked at most once an hour', async () => {
  latest = { status: 200, build: '20261113000002', version: '0.2.0' }
  assert.equal((await adminService.status()).update, null)
  assert.equal(latestCalls, 1)
  mock.timers.tick(HOUR_MS)
  assert.deepEqual((await adminService.status()).update, { latest: '0.2.0', command: 'curl -fsSL https://get.jakebox.dev | sh' })
  assert.equal(latestCalls, 2)
  assert.equal(checkIns.length, 2)
  assert.equal(checkIns[1].installId, checkIns[0].installId)
})

test('a newer build of the same version names its build', async () => {
  assert.deepEqual(await nextCheck({ status: 200, build: '20261113000002', version: config.version }), { latest: `${config.version} (build 20261113000002)`, command: 'curl -fsSL https://get.jakebox.dev | sh' })
})

test('the running build and older builds are not updates', async () => {
  assert.equal(await nextCheck({ status: 200, build: RUNNING, version: config.version }), null)
  assert.equal(await nextCheck({ status: 200, build: '20261112000000', version: '0.0.9' }), null)
})

test('a dev build never offers an update', async () => {
  config.build = 'dev'
  assert.equal(await nextCheck({ status: 200, build: '20261113000002', version: '0.2.0' }), null)
  config.build = RUNNING
})

test('an unreachable console never breaks Admin', async () => {
  await new Promise((resolve) => fakeConsole.close(resolve))
  mock.timers.tick(HOUR_MS)
  const admin = await adminService.status()
  assert.equal(admin.object, 'admin')
  assert.equal(admin.update, null)
})
