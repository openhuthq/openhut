import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer, type AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { connect, generateKeyPair, toHex, type TunnelError } from '@openhut/tunnel'
import { canonical, type Access, type Unsigned } from '@openhut/common/access/access.ts'

const port = await new Promise<number>((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo
    probe.close(() => resolve(port))
  })
})
process.env.OPENHUT_TAILNET_PORT = String(port)
const { accessService } = await import('../../../src/server/access/access-service.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { computerId, relayKeyHex } = await import('../../../src/server/platform/secrets.ts')
const { relayService } = await import('../../../src/server/relay/relay-service.ts')
const { who } = await import('../../../src/server/team/identity.ts')

await migrate()
const owner = generateKeyPairSync('ed25519')
const ownerKey = Buffer.from(owner.publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex')
const mac = generateKeyPair()
const unsigned: Unsigned = { object: 'access', owner: ownerKey, version: 1, clients: [{ key: toHex(mac.publicKey), name: 'Mac', addedAt: '2026-11-22T09:00:00.000Z' }], computers: [] }
const list: Access = { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') }
await accessService.put({ access: list, local: true })

const app = Fastify()
app.get('/caller', async (req) => who(req))
await app.ready()
await relayService.start({ server: app.server })
const computer = { id: computerId, key: relayKeyHex }
const url = `ws://127.0.0.1:${port}`

test('the Mac on the list reaches the runtime straight over the tailnet port, as the owner and never local', async () => {
  const tunnel = await connect({ relayUrl: '', url, computer, key: mac })
  const caller = await tunnel.fetch('/caller')
  assert.equal(caller.status, 200)
  assert.equal(((await caller.json()) as { local: boolean }).local, false)
  assert.equal(relayService.state().tailnet?.open, 1)
  tunnel.close()
})

test('a key that isn\'t on the list never gets past the handshake', async () => {
  await assert.rejects(connect({ relayUrl: '', url, computer, key: generateKeyPair(), timeout: 3000 }), (error: TunnelError) => error.type === 'closed')
})

test('nothing listening counts as offline', async () => {
  await assert.rejects(connect({ relayUrl: '', url: 'ws://127.0.0.1:1', computer, key: mac, timeout: 3000 }), (error: TunnelError) => error.type === 'offline')
})

test.after(async () => {
  relayService.stop()
  await app.close()
})
