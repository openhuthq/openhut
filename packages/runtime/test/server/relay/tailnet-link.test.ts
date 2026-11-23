import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { boxKey, identity, toBase64 } from '@openhut/common/vault/vault.ts'
import { connect, toHex, type TunnelError } from '@openhut/tunnel'

const port = await new Promise<number>((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo
    probe.close(() => resolve(port))
  })
})
process.env.OPENHUT_TAILNET_PORT = String(port)
const { keyStore } = await import('../../../src/server/cloud/key-store.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { relayIdOf, relayService, tunnelKey } = await import('../../../src/server/relay/relay-service.ts')
const { who } = await import('../../../src/server/team/identity.ts')

await migrate()
const mac = await identity()
const macKey = await boxKey(mac.secret)
await keysService.open({ sub: 'google-mo', email: 'mo@example.com' })
const list = await keysService.addDevice(toBase64(mac.publicKey))
const account = keysService.account()
if (list && account) await keyStore.write({ ...await keyStore.read(), account: { ...account, list } })

const app = Fastify()
app.get('/api/threads/:id', async (req) => who(req))
await app.ready()
await relayService.start({ server: app.server })
const key = (await tunnelKey()).publicKey
const computer = { id: relayIdOf(key), key: toHex(key) }
const url = `ws://127.0.0.1:${port}`

test('a Mac on your list reaches the runtime straight over the tailnet port, as you and never local', async () => {
  const tunnel = await connect({ relayUrl: '', url, computer, key: macKey, token: '' })
  const caller = await tunnel.fetch('/api/threads/th_one')
  assert.equal(caller.status, 200)
  assert.equal(((await caller.json()) as { local: boolean }).local, false)
  assert.equal(relayService.state().tailnet?.open, 1)
  tunnel.close()
})

test('a key no list holds is told it was removed', async () => {
  const tunnel = await connect({ relayUrl: '', url, computer, key: await boxKey((await identity()).secret), token: '', timeout: 3000 })
  await assert.rejects(tunnel.fetch('/api/threads/th_one'), (error: TunnelError) => error.type === 'removed')
})

test('with the relay URL empty, nothing connects to the relay', () => {
  assert.equal(relayService.state().relay, false)
})

test('nothing listening counts as offline', async () => {
  await assert.rejects(connect({ relayUrl: '', url: 'ws://127.0.0.1:1', computer, key: macKey, token: '', timeout: 3000 }), (error: TunnelError) => error.type === 'offline')
})

test.after(async () => {
  relayService.stop()
  await app.close()
})
