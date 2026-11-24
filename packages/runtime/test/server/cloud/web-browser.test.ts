import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { facesOf } from '@openhut/common/cloud/faces.ts'
import { bootCloud, devSignIn, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: a browser signs in from the web app with WebCrypto keys, asks, and once this Mac approves it the relay lets it in; it gets no account key, and Remove shuts it out', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { memberOf, tunnelKeyOf } = await import('../../../src/server/team/identity.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const home = keysService.mustBeOn().workspace.id

    const { device, client, asComputer } = await webBrowser({ url: cloud.url, email: 'mo@example.com' })
    const nonce = 'n'.repeat(43)
    const url = `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(device)}`
    const knock = client.knock({ team: home, nonce })
    assert.equal((await knock.ask({ name: 'Chrome', os: 'web' })).asked, true)
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)

    await cloudEvents.refreshRequests(home)
    assert.equal((await app.inject({ method: 'POST', url: `${url}/reviews`, headers })).statusCode, 200)
    assert.equal(await knock.reveal(), true)
    await cloudEvents.refreshRequests(home)
    const approved = await app.inject({ method: 'POST', url: `${url}/approvals`, headers, payload: { faces: facesOf({ device, nonce }) } })
    assert.equal(approved.statusCode, 200, approved.body)
    assert.equal(memberOf(tunnelKeyOf(device))?.own, true)
    assert.deepEqual(await asComputer.team(home).letters(), [])
    assert.deepEqual(await knock.state(), { step: 'approved' })

    assert.equal((await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(device)}`, headers })).statusCode, 200)
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)
  } finally {
    await app.close()
    await cloud.close()
  }
})
