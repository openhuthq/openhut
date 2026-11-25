import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { userInfo } from 'node:os'
import Fastify from 'fastify'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { listenLocally, who } from '../../../src/server/team/identity.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.get('/caller', async (req) => who(req))
await app.listen({ port: 0, host: '127.0.0.1' })
const local = await listenLocally({ server: app.server, path: `${config.dataDir}/identity.sock` })
const port = (app.server.address() as AddressInfo).port
test.after(async () => { local.close(); await app.close() })

const get = (options: { socketPath?: string; port?: number; key?: string }) => new Promise<{ status: number; body: { email?: string; local?: boolean } }>((resolve, reject) => {
  request({ path: '/caller', host: '127.0.0.1', ...options.socketPath ? { socketPath: options.socketPath } : { port: options.port }, headers: options.key ? { authorization: `Bearer ${options.key}` } : {} }, (res) => {
    let raw = ''
    res.on('data', (chunk) => { raw += chunk }).on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }))
  }).on('error', reject).end()
})

test('the local socket is the owner, and only its user can open it', async () => {
  const reply = await get({ socketPath: `${config.dataDir}/identity.sock` })
  assert.deepEqual([reply.status, reply.body.email, reply.body.local], [200, userInfo().username, true])
  assert.equal(statSync(`${config.dataDir}/identity.sock`).mode & 0o777, 0o600)
})

test('over TCP, only the install\'s key gets in', async () => {
  assert.equal((await get({ port, key: 'test-key' })).status, 200)
  assert.equal((await get({ port, key: 'wrong-key' })).status, 401)
  assert.equal((await get({ port })).status, 401)
})
