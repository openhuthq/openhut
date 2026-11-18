import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { request, type RequestOptions } from 'node:http'
import type { AddressInfo } from 'node:net'
import { duplexPair } from 'node:stream'
import Fastify from 'fastify'
import { canonical, type Access, type Unsigned } from '@openhut/common/access/access.ts'
import { accessController } from '../../../src/server/access/access-controller.ts'
import { accessService } from '../../../src/server/access/access-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'
import { listenLocally, tagDevice } from '../../../src/server/team/identity.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
await app.register(accessController, { prefix: '/api/access' })
await app.listen({ port: 0, host: '127.0.0.1' })
const local = await listenLocally({ server: app.server, path: config.socket })
const tcp = { host: '127.0.0.1', port: (app.server.address() as AddressInfo).port, headers: { authorization: 'Bearer test-key' } }
const socket = { socketPath: config.socket }
const AT = '2026-11-18T09:00:00.000Z'
const MAC = randomBytes(32).toString('hex')
const PHONE = randomBytes(32).toString('hex')
const owner = keys()
const stranger = keys()

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  return { privateKey, key: Buffer.from(jwk.x ?? '', 'base64url').toString('hex') }
}

function list({ by = owner, version, clients }: { by?: { privateKey: KeyObject; key: string }; version: number; clients: string[] }): Access {
  const unsigned: Unsigned = { object: 'access', owner: by.key, version, clients: clients.map((key) => ({ key, name: key === MAC ? 'Mo\'s Mac' : 'Mo\'s iPhone', addedAt: AT })), computers: [] }
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), by.privateKey).toString('hex') }
}

function ask({ via, method = 'GET', body }: { via: RequestOptions; method?: string; body?: unknown }) {
  return new Promise<{ status?: number; body: { version?: number; owner?: string; error?: { message: string; param?: string } } }>((done, fail) => {
    const json = body === undefined ? undefined : JSON.stringify(body)
    request({ path: '/api/access', method, ...via, headers: { ...via.headers, ...(json && { 'content-type': 'application/json' }) } }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk: string) => { text += chunk }).on('end', () => done({ status: res.statusCode, body: JSON.parse(text) }))
    }).on('error', fail).end(json)
  })
}

const put = ({ via, access }: { via: RequestOptions; access: Access }) => ask({ via, method: 'PUT', body: access })

test('a computer with no list answers 404 with an error', async () => {
  const none = await ask({ via: tcp })
  assert.equal(none.status, 404)
  assert.match(none.body.error?.message ?? '', /no access list yet/)
  assert.equal(accessService.device(MAC), 'unknown')
})

test('a computer added before access lists takes its first owner from the enrolled key', async () => {
  assert.equal((await put({ via: { ...tcp, headers: {} }, access: list({ version: 1, clients: [MAC, PHONE] }) })).status, 401)
  const first = await put({ via: tcp, access: list({ version: 1, clients: [MAC, PHONE] }) })
  assert.equal(first.status, 200)
  assert.equal((await ask({ via: tcp })).body.version, 1)
  assert.equal(accessService.device(PHONE), 'client')
})

test('the same or an older version is refused', async () => {
  const same = await put({ via: socket, access: list({ version: 1, clients: [MAC] }) })
  assert.equal(same.status, 409)
  assert.equal(same.body.error?.param, 'version')
})

test('a bad signature is refused, even on the socket', async () => {
  const tampered = { ...list({ version: 2, clients: [MAC] }), version: 3 }
  const bad = await put({ via: socket, access: tampered })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error?.param, 'signature')
  const forged = await put({ via: socket, access: { ...list({ by: stranger, version: 9, clients: [MAC] }), owner: owner.key } })
  assert.equal(forged.status, 400)
  assert.equal((await ask({ via: tcp })).body.version, 1)
})

test('a removed key is reported removed, and a stale computer\'s older list never brings it back', async () => {
  const v2 = list({ version: 2, clients: [MAC, PHONE] })
  const v3 = list({ version: 3, clients: [MAC] })
  assert.equal((await put({ via: tcp, access: v3 })).status, 200)
  assert.equal(accessService.device(PHONE), 'removed')
  assert.equal(accessService.device(MAC), 'client')
  assert.equal(accessService.device(randomBytes(32).toString('hex')), 'unknown')
  assert.equal((await put({ via: tcp, access: v2 })).status, 409)
  assert.equal((await put({ via: socket, access: v2 })).status, 409)
  assert.equal(accessService.device(PHONE), 'removed')
})

test('a removed device\'s connection is refused and a client\'s is the owner', async () => {
  const device = (key: string) => () => {
    const [ours, theirs] = duplexPair()
    app.server.emit('connection', tagDevice({ conn: ours, key }))
    return theirs
  }
  assert.equal((await ask({ via: { createConnection: device(MAC) } })).status, 200)
  assert.equal((await ask({ via: { createConnection: device(PHONE) } })).status, 401)
})

test('another owner is refused unless the request is local', async () => {
  const theirs = list({ by: stranger, version: 1, clients: [PHONE] })
  const remote = await put({ via: tcp, access: theirs })
  assert.equal(remote.status, 403)
  assert.equal(remote.body.error?.param, 'owner')
  assert.equal((await put({ via: socket, access: theirs })).status, 200)
  assert.equal((await ask({ via: tcp })).body.owner, stranger.key)
  assert.equal(accessService.device(PHONE), 'client')
  assert.equal(accessService.device(MAC), 'removed')
})

test.after(async () => {
  local.close()
  await app.close()
})
