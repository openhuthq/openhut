import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import Fastify from 'fastify'
import { connect, generateKeyPair, toHex, type Tunnel, type TunnelError } from '@openhut/tunnel'
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

await migrate()
const owner = generateKeyPairSync('ed25519')
const ownerKey = Buffer.from(owner.publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex')
const MAC = randomBytes(32).toString('hex')
const computer = { id: computerId, key: relayKeyHex }
const app = Fastify()
answerErrors(app)
app.get('/api/agents', async () => ({ object: 'list', data: [] }))
await app.register(invitationController, { prefix: '/api/invitations' })
await app.ready()
let version = 0
let served: { close: () => void } | undefined

function signed(clients: string[]): Access {
  const unsigned: Unsigned = { object: 'access', owner: ownerKey, version: ++version, clients: [MAC, ...clients].map((key) => ({ key, name: 'Device', addedAt: '2026-11-18T09:00:00.000Z' })), computers: [] }
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') }
}

const ask = async ({ method = 'GET', url }: { method?: 'GET' | 'POST' | 'DELETE'; url: string }) => {
  const response = await app.inject({ method, url, headers: { authorization: 'Bearer test-key' } })
  return { status: response.statusCode, body: response.json() }
}
const invite = async (): Promise<Invitation & { secret: string }> => {
  const { body } = await ask({ method: 'POST', url: '/api/invitations' })
  return { ...body, secret: new URL(body.code).searchParams.get('s') }
}
const look = async (id: string): Promise<Invitation> => (await ask({ url: `/api/invitations/${id}` })).body
const join = (secret: string, key = generateKeyPair()) => connect({ relayUrl: relay.url, computer, key, invitation: { secret, name: 'Mo\'s iPhone', kind: 'client' } })
const messages = async (tunnel: Tunnel) => {
  const seen = []
  for await (const message of tunnel.control) seen.push(message)
  return seen
}

test('with no list yet there is no owner to put in a code, so no invitation', async () => {
  const { status, body } = await ask({ method: 'POST', url: '/api/invitations' })
  assert.equal(status, 404)
  assert.match(body.error.message, /no access list yet/)
  await accessService.put({ access: signed([]), local: true })
  served = await relayService.start({ server: app.server })
  await waitFor(relay.online)
})

test('a code carries this computer, its Noise key, the list\'s owner, a secret and the relay', async () => {
  const invitation = await invite()
  const code = new URL(invitation.code ?? '')
  assert.equal(`${code.protocol}//${code.host}`, 'openhut://join')
  assert.deepEqual(Object.fromEntries(code.searchParams), { c: computerId, k: relayKeyHex, o: ownerKey, s: invitation.secret, r: relay.url })
  assert.match(invitation.secret, /^[0-9a-f]{64}$/)
  assert.equal(invitation.status, 'waiting')
  assert.equal(Date.parse(invitation.expiresAt) - Date.now() > 4 * 60_000, true)
  assert.equal((await look(invitation.id)).code, undefined)
})

test('a wrong secret gets no device and leaves the invitation waiting', async () => {
  const invitation = await invite()
  assert.deepEqual(await messages(await join(randomBytes(32).toString('hex'))), [])
  assert.deepEqual(await look(invitation.id), { object: 'invitation', id: invitation.id, status: 'waiting', expiresAt: invitation.expiresAt, device: null, digits: null })
})

test('a joined device shows the same digits on both sides, can\'t reach a route before it\'s accepted, and the invitation can\'t be used twice', async () => {
  const invitation = await invite()
  const key = generateKeyPair()
  const tunnel = await join(invitation.secret, key)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  assert.deepEqual(await look(invitation.id), { object: 'invitation', id: invitation.id, status: 'joined', expiresAt: invitation.expiresAt, device: { name: 'Mo\'s iPhone', kind: 'client', key: toHex(key.publicKey) }, digits: tunnel.digits })
  assert.deepEqual(await messages(await join(invitation.secret)), [])
  assert.equal((await look(invitation.id)).device?.key, toHex(key.publicKey))
  await assert.rejects(tunnel.fetch('/api/agents'), (error: TunnelError) => error.type === 'removed')
})

test('the owner declining tells the device and ends the session', async () => {
  const invitation = await invite()
  const tunnel = await join(invitation.secret)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  assert.equal((await ask({ method: 'DELETE', url: `/api/invitations/${invitation.id}` })).body.status, 'declined')
  assert.deepEqual(await messages(tunnel), [{ type: 'declined' }])
})

test('an expired invitation lets nobody join, and one that runs out while joined is declined', async () => {
  const late = await invite()
  const pending = await invite()
  const waiting = await join(pending.secret)
  await waitFor(async () => (await look(pending.id)).status === 'joined')
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 5 * 60_000 + 1000 })
  try {
    assert.equal((await look(late.id)).status, 'expired')
    assert.deepEqual(await messages(await join(late.secret)), [])
    assert.equal((await look(late.id)).device, null)
    assert.deepEqual(await messages(waiting), [{ type: 'declined' }])
    assert.equal((await look(pending.id)).status, 'expired')
  } finally {
    mock.timers.reset()
  }
})

test('the device is accepted as soon as the list holds its key, with that list, and then reaches routes', async () => {
  const invitation = await invite()
  const key = generateKeyPair()
  const tunnel = await join(invitation.secret, key)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  const list = signed([toHex(key.publicKey)])
  await accessService.put({ access: list, local: true })
  const control = tunnel.control[Symbol.asyncIterator]()
  assert.deepEqual((await control.next()).value, { type: 'accepted', access: list })
  assert.equal((await look(invitation.id)).status, 'accepted')
  assert.equal((await tunnel.fetch('/api/agents')).status, 200)
  assert.equal((await ask({ method: 'DELETE', url: `/api/invitations/${invitation.id}` })).status, 409)
  tunnel.close()
})

test.after(async () => {
  served?.close()
  await app.close()
  await relay.close()
})
