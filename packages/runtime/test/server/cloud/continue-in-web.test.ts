import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { facesOf } from '@openhut/common/cloud/faces.ts'
import { bootCloud, browserKey, devSignIn, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: Continue in web asks for Touch ID once, opens the same page with a one-use 60-second code, and this Mac lets in the browser that used it with no knock; an invited teammate’s browser knocks and gets in as a member with no team key', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { config } = await import('../../../src/server/platform/config.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { invitationController } = await import('../../../src/server/cloud/invite-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { userPresence } = await import('../../../src/server/cloud/user-presence.ts')
  const { memberOf, tunnelKeyOf } = await import('../../../src/server/team/identity.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  await app.register(invitationController, { prefix: '/api/invitations' })
  const headers = { authorization: 'Bearer test-key' }
  const asked: string[] = []
  let touched = true
  const presence = mock.method(userPresence, 'ask', async (reason: string) => { asked.push(reason); return touched })
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const home = keysService.mustBeOn().workspace.id

    touched = false
    const refused = await app.inject({ method: 'POST', url: '/api/cloud/web-links', headers, payload: { path: '/agents/ag_1' } })
    assert.equal(refused.statusCode, 403, 'no Touch ID, no link')
    touched = true
    assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/web-links', headers, payload: { path: '//evil.example/x' } })).statusCode, 400)
    const made = await app.inject({ method: 'POST', url: '/api/cloud/web-links', headers, payload: { path: '/agents/ag_1' } })
    assert.equal(made.statusCode, 200, made.body)
    const { url, expiresAt } = made.json<{ url: string; expiresAt: string }>()
    assert.match(url, new RegExp(`^${config.webUrl}/agents/ag_1#continue=[A-Za-z0-9_-]+$`))
    assert.ok(Date.parse(expiresAt) - Date.now() <= 60_000)
    assert.deepEqual(asked, ['open this page in your browser, signed in', 'open this page in your browser, signed in'], 'one Touch ID per click')

    const code = new URL(url).hash.slice('#continue='.length)
    const browser = await browserKey({ url: cloud.url })
    const signed = await browser.client.signIn({ joinCode: code })
    assert.equal('email' in signed && signed.email, 'mo@example.com')
    for (let i = 0; i < 100 && memberOf(tunnelKeyOf(browser.device))?.own !== true; i++) await sleep(100)
    assert.equal(memberOf(tunnelKeyOf(browser.device))?.own, true, 'the Mac let in the browser that used its code, with no knock and no faces')
    assert.equal((await browser.client.me())?.workspaces.find((each) => each.id === home)?.access, 'listed')
    const again = await browserKey({ url: cloud.url })
    await assert.rejects(again.client.signIn({ joinCode: code }), 'a second use fails')

    const invited = await app.inject({ method: 'POST', url: '/api/invitations/cloud', headers, payload: { workspace: home, email: 'sara@example.com', role: 'member' } })
    assert.equal(invited.statusCode, 200, invited.body)
    const sara = await webBrowser({ url: cloud.url, email: 'sara@example.com' })
    const nonce = 'n'.repeat(43)
    const knock = sara.client.knock({ team: home, nonce })
    assert.equal((await knock.ask({ name: 'Chrome (web)', os: 'web' })).asked, true)
    const at = `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(sara.device)}`
    await cloudEvents.refreshRequests(home)
    assert.equal((await app.inject({ method: 'POST', url: `${at}/reviews`, headers })).statusCode, 200)
    assert.equal(await knock.reveal(), true)
    await cloudEvents.refreshRequests(home)
    const approved = await app.inject({ method: 'POST', url: `${at}/approvals`, headers, payload: { faces: facesOf({ device: sara.device, nonce }) } })
    assert.equal(approved.statusCode, 200, approved.body)
    assert.deepEqual(memberOf(tunnelKeyOf(sara.device)), { email: 'sara@example.com', own: false, workspaces: [home] })
    assert.deepEqual(await knock.state(), { step: 'approved' })
    assert.deepEqual(await sara.asComputer.team(home).letters(), [], 'the teammate’s browser gets no team key')
    assert.equal((await sara.client.me())?.workspaces.find((each) => each.id === home)?.role, 'member')
  } finally {
    presence.mock.restore()
    await app.close()
    await cloud.close()
  }
})
