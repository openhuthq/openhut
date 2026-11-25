import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { accountDevice } from '@openhut/common/keyring/keys.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/public.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: Lost or stolen on a managed account seals a fresh escrow box to the new account key', { skip }, async () => {
  const cloud = await bootCloud({ managed: true })
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validatorCompiler } = await import('fastify-type-provider-zod')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloud: ours } = await import('../../../src/server/platform/cloud.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validatorCompiler)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  const signer = async (key: string) => toBase64((await accountDevice(fromBase64(key))).publicKey)
  const escrowBy = async () => (await ours.keyBoxes.list())?.find((box) => box.id === 'escrow')?.by
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const before = keysService.mustBeOn()
    assert.equal(await escrowBy(), await signer(before.key))

    const changed = await app.inject({ method: 'POST', url: `/api/cloud/workspaces/${before.workspace.id}/keys`, headers })
    assert.equal(changed.statusCode, 200, changed.body)
    const after = keysService.mustBeOn()
    assert.notEqual(after.key, before.key, 'the account key changed')
    assert.equal(await escrowBy(), await signer(after.key), 'our backup holds the new account key, not the old one')
  } finally {
    await app.close()
    await cloud.close()
  }
})
