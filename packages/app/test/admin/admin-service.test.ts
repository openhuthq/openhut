import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const HOUR_MS = 60 * 60_000
const checkIns: { installId: string; build: string; version: string }[] = []
let latest: { status: number; build?: string; version?: string } = { status: 500 }
let latestCalls = 0

const fakeConsole = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url === '/api/installs') {
      checkIns.push(JSON.parse(body))
      return res.end('{}')
    }
    latestCalls += 1
    res.statusCode = latest.status
    res.end(JSON.stringify({
      id: 'rel_1', object: 'release', build: latest.build, version: latest.version, sha256: 'a'.repeat(64),
      url: 'https://get.jakebox.dev/jakebox.tgz', notes: '', createdAt: new Date().toISOString(),
    }))
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
mock.timers.enable({ apis: ['Date'], now: Date.now() })

test('a failing console means no update, and the install still checks in', async () => {
  assert.equal((await adminService.status()).update, null)
  assert.equal(checkIns.length, 1)
  assert.match(checkIns[0].installId, /^[\w-]{32,}$/)
  assert.deepEqual([checkIns[0].build, checkIns[0].version], [config.build, config.version])
})

test('the console is asked at most once an hour', async () => {
  latest = { status: 200, build: 'b2', version: '0.2.0' }
  assert.equal((await adminService.status()).update, null)
  assert.equal(latestCalls, 1)
  mock.timers.tick(HOUR_MS)
  assert.deepEqual((await adminService.status()).update, { latest: '0.2.0', command: 'curl -fsSL https://get.jakebox.dev | sh' })
  assert.equal(latestCalls, 2)
  assert.equal(checkIns.length, 2)
  assert.equal(checkIns[1].installId, checkIns[0].installId)
})

test('the running build is not an update', async () => {
  latest = { status: 200, build: config.build, version: config.version }
  mock.timers.tick(HOUR_MS)
  assert.equal((await adminService.status()).update, null)
})

test('an unreachable console never breaks Admin', async () => {
  await new Promise((resolve) => fakeConsole.close(resolve))
  mock.timers.tick(HOUR_MS)
  const admin = await adminService.status()
  assert.equal(admin.object, 'admin')
  assert.equal(admin.update, null)
})
