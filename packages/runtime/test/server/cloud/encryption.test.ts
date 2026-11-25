import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import { fromBase64 } from '@openhut/common/vault/public.ts'
import { unlock } from '@openhut/common/vault/secret.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: End-to-end encryption on drops our signer and escrow and moves to a fresh key the old one can’t open; off brings both back', { skip }, async () => {
  const booted = await bootCloud({ managed: true })
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { cloud } = await import('../../../src/server/platform/cloud.ts')
  await migrate()
  const app = Fastify()
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const before = keysService.mustBeOn()
    const ours = bodyOf(before.list)?.managed
    assert.ok(ours)
    assert.equal((await cloudService.status()).encryption, false, 'a new account starts with it off')

    assert.equal((await cloudService.encryption({ on: true })).encryption, true)
    const on = keysService.mustBeOn()
    assert.equal(bodyOf(on.list)?.managed, undefined, 'our signer is gone')
    assert.equal((await cloud.keyBoxes.get('escrow')).status, 404, 'and so is our backup key')
    assert.notEqual(on.key, before.key)
    const box = (await cloud.keyBoxes.list())?.find((each) => each.id === `workspace-${on.workspace.id}`)
    assert.ok(box)
    const opened = (key: string) => unlock({ keys: { 1: fromBase64(key) }, bind: `account/${on.sub}/workspace/${on.workspace.id}`, locked: fromBase64(box.body) })
    assert.ok(await opened(on.key), 'the fresh key opens the new keys')
    assert.equal(await opened(before.key), null, 'the old, escrowed key can’t')

    assert.equal((await cloudService.encryption({ on: false })).encryption, false)
    assert.equal(bodyOf(keysService.mustBeOn().list)?.managed, ours, 'off lists our signer again')
    assert.equal((await cloud.keyBoxes.get('escrow')).status, 200, 'and saves a backup key')
  } finally {
    await app.close()
    await booted.close()
  }
})
