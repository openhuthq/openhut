import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { connect, generateKeyPair, toHex, type TunnelError } from '@openhut/tunnel'
import { startRelay, waitFor } from '@openhut/tunnel/test/relay.ts'
import { canonical, type Access, type Unsigned } from '@openhut/common/access/access.ts'
import type { Invitation } from '@openhut/common/access/invitation.ts'

const relay = await startRelay()
process.env.OPENHUT_RELAY_URL = relay.url
const { accessService } = await import('../../../src/server/access/access-service.ts')
const { invitationController } = await import('../../../src/server/access/invitation-controller.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { computerId, relayKeyHex } = await import('../../../src/server/platform/secrets.ts')
const { relayService } = await import('../../../src/server/relay/relay-service.ts')
const { who } = await import('../../../src/server/team/identity.ts')

await migrate()
const owner = generateKeyPairSync('ed25519')
const ownerKey = Buffer.from(owner.publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex')
const phone = generateKeyPair()
const PHONE = toHex(phone.publicKey)
const AT = '2026-11-18T09:00:00.000Z'
const computer = { id: computerId, key: relayKeyHex }
let release = () => {}
const released = new Promise<void>((resolve) => { release = resolve })

const app = Fastify()
answerErrors(app)
app.get('/caller', async (req) => who(req))
app.post<{ Body: unknown }>('/echo', async (req) => ({ got: req.body }))
app.get('/stream', async (_req, reply) => {
  reply.hijack()
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream' })
  reply.raw.write('data: one\n\n')
  await released
  reply.raw.end('data: two\n\n')
})
await app.register(invitationController, { prefix: '/api/invitations' })
await app.ready()

function signed({ version, clients, computers = [] }: { version: number; clients: string[]; computers?: Access['computers'] }): Access {
  const unsigned: Unsigned = { object: 'access', owner: ownerKey, version, clients: clients.map((key) => ({ key, name: 'Mo\'s iPhone', addedAt: AT })), computers }
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') }
}

await accessService.put({ access: signed({ version: 1, clients: [PHONE], computers: [{ id: computerId, name: 'This Mac', key: relayKeyHex }] }), local: true })
const served = await relayService.start({ server: app.server })
await waitFor(relay.online)

test('a listed device\'s request through the relay reaches the route as the owner, never local, and its body arrives', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer, key: phone })
  const caller = await tunnel.fetch('/caller')
  assert.equal(caller.status, 200)
  assert.equal(((await caller.json()) as { local: boolean }).local, false)
  const echo = await tunnel.fetch('/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hello: 'computer' }) })
  assert.deepEqual(await echo.json(), { got: { hello: 'computer' } })
  tunnel.close()
})

test('a streamed answer arrives in chunks, the first before the route has finished', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer, key: phone })
  const response = await tunnel.fetch('/stream')
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  assert.equal(response.headers.get('transfer-encoding'), null)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  assert.equal((await reader.read()).value, 'data: one\n\n')
  release()
  assert.equal((await reader.read()).value, 'data: two\n\n')
  assert.equal((await reader.read()).done, true)
  tunnel.close()
})

test('a key the list doesn\'t hold gets closed without an answer', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer, key: generateKeyPair() })
  await assert.rejects(tunnel.fetch('/caller'), (error: TunnelError) => error.type === 'closed')
})

test('another computer joins with a code: it is on the relay while the owner decides, the owner adds it, it gets the same signed list, and the phone reaches it through the relay', async () => {
  const other = await startRelay()
  const created = await app.inject({ method: 'POST', url: '/api/invitations', headers: { authorization: 'Bearer test-key' } })
  const invitation: Invitation = created.json()
  const dir = mkdtempSync(join(tmpdir(), 'oh-join-'))
  const env: Record<string, string | undefined> = { ...process.env, OPENHUT_DATA: dir, OPENHUT_JOIN: invitation.code, OPENHUT_RELAY_URL: other.url, OPENHUT_INSTALL_KIND: 'server', PORT: '0', OPENHUT_GATEWAY_PORT: '0' }
  delete env.OPENHUT_CLIENT_KEY_SHA256
  const child = spawn(process.execPath, [new URL('../../../src/server/app.ts', import.meta.url).pathname], { env, stdio: 'ignore' })
  try {
    let joined: Invitation = invitation
    for (let tries = 0; tries < 300 && joined.status === 'waiting'; tries++) {
      await sleep(100)
      joined = (await app.inject({ url: `/api/invitations/${invitation.id}`, headers: { authorization: 'Bearer test-key' } })).json()
    }
    assert.equal(joined.status, 'joined')
    assert.equal(joined.device?.kind, 'computer')
    const second = { id: createHash('sha256').update(Buffer.from(joined.device!.key, 'hex')).digest('hex'), name: joined.device!.name, key: joined.device!.key }
    await waitFor(other.online)
    const early = await connect({ relayUrl: other.url, computer: second, key: phone })
    await assert.rejects(early.fetch('/api/me'), (error: TunnelError) => error.type === 'closed')
    const list = signed({ version: 2, clients: [PHONE], computers: [{ id: computerId, name: 'This Mac', key: relayKeyHex }, second] })
    await accessService.put({ access: list, local: true })
    let theirs: unknown
    for (let tries = 0; tries < 100 && JSON.stringify(theirs) !== JSON.stringify(list); tries++) {
      await sleep(100)
      theirs = await viaSocket({ path: join(dir, 'openhut.sock'), url: '/api/access' }).catch(() => undefined)
    }
    assert.deepEqual(theirs, list)
    const tunnel = await connect({ relayUrl: other.url, computer: second, key: phone })
    assert.equal((await tunnel.fetch('/api/me')).status, 200)
    tunnel.close()
  } finally {
    child.kill('SIGKILL')
    await other.close()
  }
})

test('a device the owner removed is told so on its next request', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer, key: phone })
  assert.equal((await tunnel.fetch('/caller')).status, 200)
  await accessService.put({ access: signed({ version: 3, clients: [] }), local: true })
  await assert.rejects(tunnel.fetch('/caller'), (error: TunnelError) => error.type === 'removed')
})

function viaSocket({ path, url }: { path: string; url: string }): Promise<unknown> {
  return new Promise((done, fail) => {
    request({ socketPath: path, path: url }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk: string) => { text += chunk }).on('end', () => done(JSON.parse(text)))
    }).on('error', fail).end()
  })
}

test.after(async () => {
  served?.close()
  await app.close()
  await relay.close()
})
