import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { cloudService } from '../../../src/server/cloud/cloud-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { settings } from '../../../src/server/platform/settings.ts'

const EXPIRED = 'This join code expired or was used already. Make a new one in the app.'

test('a server that joins with a spent code says so on /health, so the installer can tell you', async () => {
  await migrate()
  const cloud = createServer((req, res) => {
    req.resume().on('end', () => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: EXPIRED } }))
    })
  })
  await new Promise<void>((resolve) => cloud.listen(0, '127.0.0.1', resolve))
  config.apiUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`
  assert.equal(await cloudService.joining(), undefined)
  config.join = 'a-spent-join-code-0123'
  assert.deepEqual(await cloudService.joining(), { state: 'starting', error: null })
  cloudService.connect()
  for (let i = 0; i < 50 && (await cloudService.joining())?.state === 'starting'; i++) await sleep(20)
  assert.deepEqual(await cloudService.joining(), { state: 'failed', error: EXPIRED })
  cloud.close()
})

test('signing in for an invite with another Google account sets nothing up for that account and says whose invite it is', async () => {
  const cloud = createServer((req, res) => {
    req.resume().on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.url === '/v1/sessions'
        ? { object: 'session', token: 't', refreshToken: 'r', sub: 'google-mo', email: 'mo@example.com', device: Buffer.alloc(64).toString('base64url'), expiresAt: new Date(Date.now() + 60_000).toISOString() }
        : { url: 'https://accounts.example.com/o' }))
    })
  })
  await new Promise<void>((resolve) => cloud.listen(0, '127.0.0.1', resolve))
  config.apiUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`
  const { authorizationUrl } = await cloudService.start({ loginHint: 'sara@example.com' })
  assert.match(authorizationUrl, /login_hint=sara%40example.com/)
  const page = await cloudService.finish({ state: Object.keys(settings.signIns()).at(-1), code: 'c' })
  assert.match(page, /This invite is for sara@example.com, and you signed in as mo@example.com/)
  const status = await cloudService.status()
  assert.equal(status.status, 'off')
  assert.equal(status.signInError, 'This invite is for sara@example.com. You signed in as mo@example.com, so nothing was set up.')
  cloud.close()
})
