import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import type { MemberList, MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { bodyOf, withoutDevices } from '@openhut/common/cloud/member-list.ts'
import type { Identity } from '@openhut/common/vault/vault.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const PRIVATE = new URL('../../../../../private/api/', import.meta.url)

type Device = { email: string; sub: string; home: string; identity: Identity; key: string; token: string }
type Chain = { list: MemberList; body: MemberListBody }
type Kit = {
  another: (input: { email: string; sub: string; home: string }) => Promise<Device>
  grow: (input: { chain: Chain; signer: Identity; change: (body: MemberListBody) => MemberListBody }) => Promise<Chain>
  post: (who: Device, chain: Chain) => Promise<{ status: number }>
}

test('against the real cloud API: when another of your devices removes this computer, its next look at the home list shows it signed out of the account', { skip }, async () => {
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
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  const status = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string; email: string | null; needsSignIn: boolean }>()
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await status()).status !== 'on'; i++) await sleep(50)
    assert.equal((await status()).status, 'on')

    const account = keysService.mustBeOn()
    const home = account.workspace.id
    const me = await keysService.deviceKey()
    const laptop = await kit.another({ email: account.email, sub: account.sub, home })
    const added = await keysService.addDevice({ device: laptop.key, name: 'Laptop', runtime: false })
    assert.ok(added)
    await putList({ workspace: home, list: added })

    const list = roomKeys.room(home)?.list
    const body = bodyOf(list)
    assert.ok(list && body)
    const without = await kit.grow({ chain: { list, body }, signer: laptop.identity, change: (each) => withoutDevices({ body: each, gone: [me] }) })
    const posted = await kit.post(laptop, without) as { status: number; json?: unknown }
    assert.equal(posted.status, 200, JSON.stringify(posted.json))

    await cloudEvents.refreshKeys(home)
    const after = await status()
    assert.equal(after.status, 'locked')
    assert.equal(after.email, 'mo@example.com')
    assert.equal(after.needsSignIn, true)
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
