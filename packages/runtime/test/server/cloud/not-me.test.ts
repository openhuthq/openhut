import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import type { MemberList } from '@openhut/common/cloud/cloud.ts'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import { toBase64, type Identity } from '@openhut/common/vault/vault.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const PRIVATE = new URL('../../../../../private/api/', import.meta.url)

type Device = { email: string; sub: string; home: string; identity: Identity; key: string; token: string }
type Kit = {
  another: (input: { email: string; sub: string; home: string }) => Promise<Device>
  person: (email: string) => Promise<Device>
  team: (owner: Device, others: { device: Device }[]) => Promise<{ list: MemberList }>
  call: <T>(who: Device, method: 'GET' | 'PUT', url: string) => Promise<{ status: number; json: T }>
  put: (who: Device, input: { collection: 'agent'; workspace: string; id: string }) => Promise<{ status: number }>
  newId: () => string
  workspaceKey: Uint8Array
}
type Tokens = { tokens: { mint: (input: { sub: string; email: string; device: string }) => Promise<{ token: string }> } }

test('against the real cloud API: Not me takes the device off your home list and off a teammate’s team you’re in, and it then reads and writes nothing in either; Lost or stolen also resets the encryption for a new kit, a plain Remove doesn’t', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { putList } = await import('../../../src/server/cloud/cloud-service.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
  const kit = await import(new URL('test/kit.ts', PRIVATE).href) as Kit
  const { tokens } = await import(new URL('src/platform/auth.ts', PRIVATE).href) as Tokens
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  const status = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>()
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await status()).status !== 'on'; i++) await sleep(50)
    assert.equal((await status()).status, 'on')

    const account = keysService.mustBeOn()
    const home = account.workspace.id
    const key = await keysService.deviceKey()
    const thisMac: Device = { email: account.email, sub: account.sub, home, identity: await keysService.device(), key, token: (await tokens.mint({ sub: account.sub, email: account.email, device: key })).token }
    const laptop = await kit.another({ email: account.email, sub: account.sub, home })
    const added = await keysService.addDevice({ device: laptop.key, name: 'Laptop', runtime: false })
    assert.ok(added)
    await putList({ workspace: home, list: added })

    const sara = await kit.person('sara@example.com')
    const saras = await kit.team(sara, [{ device: thisMac }, { device: laptop }])
    await roomKeys.setRoom({ workspace: { id: sara.home, key: toBase64(kit.workspaceKey), version: 1 }, list: saras.list })

    const rooms = [{ ws: home, reader: thisMac }, { ws: sara.home, reader: sara }]
    for (const { ws } of rooms) assert.equal((await kit.call(laptop, 'GET', `/v1/teams/${ws}/member-list`)).status, 200)

    const removed = await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(laptop.key)}`, headers })
    assert.equal(removed.statusCode, 200, removed.body)

    for (const { ws, reader } of rooms) {
      const lists = await kit.call<{ data: MemberList[]; hasMore: boolean }>(reader, 'GET', `/v1/teams/${ws}/member-list`)
      assert.equal(lists.status, 200)
      assert.equal(lists.json.hasMore, false)
      const latest = bodyOf(lists.json.data.at(-1))
      assert.ok(latest)
      assert.equal(latest.members.some((member) => member.devices.includes(laptop.key)), false, `the laptop is still listed in ${ws}`)
      assert.ok(latest.removed.includes(laptop.key))
      assert.equal((await kit.call(laptop, 'GET', `/v1/teams/${ws}/member-list`)).status, 403)
      assert.equal((await kit.call(laptop, 'GET', `/v1/teams/${ws}/agent`)).status, 403)
      assert.equal((await kit.put(laptop, { collection: 'agent', workspace: ws, id: kit.newId() })).status, 403)
    }

    const kitOf = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ kit: { savedAt: string } | null }>().kit
    const madeKit = await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })
    assert.equal(madeKit.statusCode, 200, madeKit.body)
    const firstKit = madeKit.json<{ kitId: string }>().kitId
    const keyVersion = () => roomKeys.room(home)?.workspace.version
    const addLaptop = async () => {
      const device = await kit.another({ email: account.email, sub: account.sub, home })
      const list = await keysService.addDevice({ device: device.key, name: 'Laptop', runtime: false })
      assert.ok(list)
      await putList({ workspace: home, list })
      return device
    }

    const sold = await addLaptop()
    const before = { version: keyVersion(), kit: await kitOf() }
    assert.ok(before.kit)
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(sold.key)}`, headers })).statusCode, 200)
    assert.deepEqual({ version: keyVersion(), kit: await kitOf() }, before, 'a plain Remove keeps the keys and the kit')

    const stolen = await addLaptop()
    const lost = await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(stolen.key)}?lost=true`, headers })
    assert.equal(lost.statusCode, 200, lost.body)
    assert.ok((keyVersion() ?? 0) > (before.version ?? 0), 'lost or stolen resets the encryption')
    assert.equal(await kitOf(), null, 'and the old kit stops working, so a new one is due')
    assert.equal((await kit.call(stolen, 'GET', `/v1/member-lists?workspace=${home}`)).status, 403)
    const newKit = await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })
    assert.equal(newKit.statusCode, 200, newKit.body)
    assert.notEqual(newKit.json<{ kitId: string }>().kitId, firstKit)
    assert.ok(await kitOf())
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
