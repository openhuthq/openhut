import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { cloudService } from '../../../src/server/cloud/cloud-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'

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
  assert.equal(cloudService.joining(), undefined)
  config.join = 'a-spent-join-code-0123'
  assert.deepEqual(cloudService.joining(), { state: 'starting', error: null })
  cloudService.connect()
  for (let i = 0; i < 50 && cloudService.joining()?.state === 'starting'; i++) await sleep(20)
  assert.deepEqual(cloudService.joining(), { state: 'failed', error: EXPIRED })
  cloud.close()
})
