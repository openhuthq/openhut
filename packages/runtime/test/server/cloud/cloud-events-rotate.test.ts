import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import type { MemberList, MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { bodyOf, withoutDevices } from '@openhut/common/cloud/member-list.ts'
import { open } from '@openhut/common/records/seal.ts'
import type { SealedRow } from '@openhut/common/records/wire.ts'
import { fromBase64, type Identity } from '@openhut/common/vault/public.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const PRIVATE = new URL('../../../../../private/api/', import.meta.url)

type Device = { email: string; sub: string; home: string; identity: Identity; key: string; token: string }
type Chain = { list: MemberList; body: MemberListBody }
type Kit = {
  person: (email: string) => Promise<Device>
  another: (input: { email: string; sub: string; home: string }) => Promise<Device>
  grow: (input: { chain: Chain; signer: Identity; change: (body: MemberListBody) => MemberListBody }) => Promise<Chain>
  post: (who: Device, chain: Chain) => Promise<{ status: number }>
  call: <T>(who: Device, method: 'GET', url: string) => Promise<{ status: number; json: T }>
}

test('against the real cloud API: when a teammate takes one of their devices off your team, your runtime changes the team key, and that device can’t open what you write after', { skip }, async () => {
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
  const { recordsService } = await import('../../../src/server/cloud/records.ts')
  const kit = await import(new URL('test/kit.ts', PRIVATE).href) as Kit
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

    const home = keysService.mustBeOn().workspace.id
    const sara = await kit.person('sara@example.com')
    const saraPhone = await kit.another(sara)
    const room = roomKeys.room(home)
    const body = bodyOf(room?.list)
    assert.ok(room && body)
    const joined = await kit.grow({ chain: { list: room.list, body }, signer: await keysService.device(), change: (each) => ({ ...each, members: [...each.members, { email: sara.email, role: 'member', devices: [sara.key, saraPhone.key], viewers: [] }] }) })
    await putList({ workspace: home, list: joined.list })
    const oldKey = roomKeys.room(home)?.workspace.key ?? ''
    assert.equal(roomKeys.room(home)?.workspace.version, 1)

    const dropped = await kit.grow({ chain: joined, signer: sara.identity, change: (each) => withoutDevices({ body: each, gone: [saraPhone.key] }) })
    assert.equal((await kit.post(sara, dropped)).status, 200)
    await cloudEvents.refreshKeys(home)
    for (let i = 0; i < 100 && roomKeys.room(home)?.workspace.version !== 2; i++) await sleep(50)
    assert.equal(roomKeys.room(home)?.workspace.version, 2)
    assert.notEqual(roomKeys.room(home)?.workspace.key, oldKey)
    const letters = await kit.call<{ data: { to: string }[] }>(sara, 'GET', `/v1/teams/${home}/letter`)
    assert.equal(letters.status, 200)
    assert.ok(letters.json.data.some((each) => each.to === sara.key))

    await recordsService.put({ collection: 'workspace', id: home, workspace: home, value: { name: 'Written after the phone left' } })
    await recordsService.drain()
    const read = await kit.call<SealedRow>(sara, 'GET', `/v1/teams/${home}/workspace/${home}`)
    assert.equal(read.status, 200)
    const row = read.json
    const ring = (version: number, key: string) => () => ({ version, keys: { [version]: fromBase64(key) } })
    assert.deepEqual((await open({ row, keys: ring(2, roomKeys.room(home)?.workspace.key ?? '') }))?.value.workspace, { name: 'Written after the phone left' })
    assert.equal((await open({ row, keys: ring(1, oldKey) }))?.value.workspace, undefined)
    assert.equal((await kit.call(saraPhone, 'GET', `/v1/teams/${home}/workspace`)).status, 403)
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
