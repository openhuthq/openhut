import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { request, type RequestOptions } from 'node:http'
import type { AddressInfo } from 'node:net'
import { userInfo } from 'node:os'
import { duplexPair } from 'node:stream'
import Fastify from 'fastify'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { innerAuthorization, listenLocally, tagDevice, who } from '../../../src/server/team/identity.ts'
import { meController } from '../../../src/server/team/team-controller.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.get('/caller', async (req) => who(req))
await app.register(meController, { prefix: '/api/me' })
await app.listen({ port: 0, host: '127.0.0.1' })
const local = await listenLocally({ server: app.server, path: config.socket })
const tcp = { host: '127.0.0.1', port: (app.server.address() as AddressInfo).port }
const device = () => {
  const [ours, theirs] = duplexPair()
  app.server.emit('connection', tagDevice({ conn: ours, key: 'ab'.repeat(32) }))
  return theirs
}
const ask = (options: RequestOptions) => new Promise<{ status?: number; body: { local?: boolean; user?: { email: string } } }>((done, fail) => {
  request({ path: '/caller', ...options }, (res) => {
    let body = ''
    res.setEncoding('utf8').on('data', (chunk: string) => { body += chunk }).on('end', () => done({ status: res.statusCode, body: JSON.parse(body) }))
  }).on('error', fail).end()
})

test('a server install listens on TCP and on a socket only its own user can open', () => {
  assert.equal(config.installKind, 'server')
  assert.equal(statSync(config.socket).mode & 0o777, 0o600)
})

test('a request on the socket is the owner and local, with or without a key', async () => {
  const owner = await ask({ socketPath: config.socket })
  assert.equal(owner.status, 200)
  assert.equal(owner.body.local, true)
  assert.deepEqual(await ask({ socketPath: config.socket, headers: { authorization: 'Bearer wrong-key' } }), owner)
  const me = await ask({ socketPath: config.socket, path: '/api/me' })
  assert.equal(me.status, 200)
  assert.equal(me.body.user?.email, userInfo().username)
})

test('a request over TCP is the owner only with the key the app enrolled, and never local', async () => {
  assert.equal((await ask(tcp)).status, 401)
  assert.equal((await ask({ ...tcp, headers: { authorization: 'Bearer wrong-key' } })).status, 401)
  assert.equal((await ask({ ...tcp, path: '/api/me' })).status, 401)
  const owner = await ask({ socketPath: config.socket })
  assert.deepEqual(await ask({ ...tcp, headers: { authorization: 'Bearer test-key' } }), { status: 200, body: { ...owner.body, local: false } })
  assert.equal((await ask({ ...tcp, path: '/api/me', headers: { authorization: 'Bearer test-key' } })).status, 200)
})

test('a request on a device\'s connection is refused while no device is a client, key or not', async () => {
  assert.equal((await ask({ createConnection: device })).status, 401)
  assert.equal((await ask({ createConnection: device, headers: { authorization: 'Bearer test-key' } })).status, 401)
  assert.equal((await ask({ createConnection: device, path: '/api/me' })).status, 401)
})

test('the control MCP\'s calls inside the runtime keep the caller, and a made-up inner key is refused', async () => {
  const caller = { id: 'usr_x', email: 'x', local: true }
  assert.equal((await ask({ ...tcp, headers: { authorization: innerAuthorization(caller) } })).body.local, true)
  assert.equal((await ask({ ...tcp, headers: { authorization: innerAuthorization({ ...caller, local: false }) } })).body.local, false)
  assert.equal((await ask({ ...tcp, headers: { authorization: `Inner ${'0'.repeat(64)} local` } })).status, 401)
})

test.after(async () => {
  local.close()
  await app.close()
})
