import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import { bootCloud, devSignIn, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: a new account starts managed, so a second browser and an invited teammate are in without anyone approving', { skip }, async () => {
  const cloud = await bootCloud({ managed: true })
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validatorCompiler } = await import('fastify-type-provider-zod')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloud: ours } = await import('../../../src/server/platform/cloud.ts')
  const { inviteService } = await import('../../../src/server/cloud/invite-service.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
  const { memberOf, tunnelKeyOf } = await import('../../../src/server/team/identity.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validatorCompiler)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const account = keysService.mustBeOn()
    const home = account.workspace.id

    const browser = await webBrowser({ url: cloud.url, email: 'mo@example.com' })
    const me = await browser.client.me()
    assert.ok(me?.managed, 'our servers say which key is theirs')
    assert.equal(bodyOf(account.list)?.managed, me.managed, 'the account starts with our signer listed')
    assert.ok((await ours.keyBoxes.list())?.some((box) => box.id === 'escrow'), 'and our backup key saved')

    assert.equal((await browser.client.knock({ team: home }).ask({ name: 'Chrome', os: 'web' })).asked, true)
    await roomKeys.refresh({ ws: home })
    assert.equal(memberOf(tunnelKeyOf(browser.device))?.own, true, 'the second browser is in, with no approval')

    const invited = await inviteService.inviteToCloud({ workspace: home, email: 'ana@example.com', role: 'member' })
    const ana = await webBrowser({ url: cloud.url, email: 'ana@example.com' })
    assert.equal((await ana.client.knock({ team: home }).ask({ name: 'Firefox', os: 'web' })).asked, true)
    await roomKeys.refresh({ ws: home })
    const anaIn = memberOf(tunnelKeyOf(ana.device))
    assert.equal(anaIn?.email, 'ana@example.com', 'the invited teammate is in, no owner step')
    assert.equal(roomKeys.members(home)?.members.find((each) => each.email === 'ana@example.com')?.role, invited.role)
    assert.equal(roomKeys.members(home)?.invites.length, 0, 'the invite is used up')
  } finally {
    await app.close()
    await cloud.close()
  }
})
