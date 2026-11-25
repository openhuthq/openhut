import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { FACES } from '@openhut/common/cloud/cloud.ts'
import { facesOf } from '@openhut/common/cloud/faces.ts'
import { bootCloud, devSignIn, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: a knock is let in only with the right pair, user presence asked by the runtime, and within 15 minutes; a wrong pick turns it down for good and alerts every other computer through the Cloud; a Mac closed mid-request shows it when reopened', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validatorCompiler } = await import('fastify-type-provider-zod')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { cloud: runtimeCloud } = await import('../../../src/server/platform/cloud.ts')
  const { userPresence } = await import('../../../src/server/cloud/user-presence.ts')
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
    const home = keysService.mustBeOn().workspace.id

    const browser = async () => {
      const { device, client } = await webBrowser({ url: cloud.url, email: 'mo@example.com' })
      const url = `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(device)}`
      const knock = async () => {
        const nonce = randomBytes(32).toString('base64url')
        const knocked = client.knock({ team: home, nonce })
        assert.equal((await knocked.ask({ name: 'Chrome', os: 'web' })).asked, true)
        await cloudEvents.refreshRequests(home)
        assert.equal((await app.inject({ method: 'POST', url: `${url}/reviews`, headers })).statusCode, 200)
        assert.equal(await knocked.reveal(), true)
        await cloudEvents.refreshRequests(home)
        return facesOf({ device, nonce })
      }
      const approve = (faces: number[]) => app.inject({ method: 'POST', url: `${url}/approvals`, headers, payload: { faces } })
      return { device, client, knock, approve, url }
    }
    const { device, knock, approve } = await browser()

    const asked: string[] = []
    userPresence.ask = async (reason) => { asked.push(reason); return false }
    const faces = await knock()
    const refused = await approve(faces)
    assert.equal(refused.statusCode, 403, refused.body)
    assert.deepEqual(asked, ['let Chrome into OpenHut'])
    assert.equal(memberOf(tunnelKeyOf(device)), undefined, 'no presence, no way in')

    userPresence.ask = async () => true
    const wrong = Array.from({ length: FACES }, (_, i) => i).filter((each) => !faces.includes(each)).slice(0, 2)
    const missed = await approve(wrong)
    assert.equal(missed.statusCode, 400, missed.body)
    assert.equal((await approve(faces)).statusCode, 404, 'a wrong pick turned the request down; the right pair can’t revive it')
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)

    const again = await knock()
    const now = Date.now()
    const late = mock.method(Date, 'now', () => now + 15 * 60_000 + 1000)
    const expired = await approve(again)
    late.mock.restore()
    assert.equal(expired.statusCode, 410, expired.body)
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)

    const letIn = await approve(again)
    assert.equal(letIn.statusCode, 200, letIn.body)
    assert.equal(memberOf(tunnelKeyOf(device))?.own, true)

    cloudEvents.start()
    for (let i = 0; i < 100 && !cloudEvents.ready(); i++) await sleep(50)
    const other = await browser()
    await other.knock()
    const fromAnotherComputer = await runtimeCloud.team(home).deny({ device: other.device, why: 'mismatch' })
    assert.equal(fromAnotherComputer.status, 200)
    for (let i = 0; i < 100 && !cloudEvents.turnedDown().length; i++) await sleep(50)
    assert.deepEqual(cloudEvents.turnedDown().map(({ device, name, why, workspace }) => ({ device, name, why, workspace })), [{ device: other.device, name: 'Chrome', why: 'mismatch', workspace: home }], 'a wrong pick on another computer alerts this one through the Cloud')
    const status = (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ turnedDown: unknown[] }>()
    assert.equal(status.turnedDown.length, 1)

    const third = await browser()
    await third.knock()
    assert.equal((await app.inject({ method: 'DELETE', url: `${third.url}?why=not-me`, headers })).statusCode, 200)
    await sleep(300)
    assert.equal(cloudEvents.turnedDown().length, 1, 'the computer that turned it down already said so; only the others get the alert')

    cloudEvents.stop()
    const closed = await browser()
    assert.equal((await closed.client.knock({ team: home, nonce: randomBytes(32).toString('base64url') }).ask({ name: 'Firefox', os: 'web' })).asked, true)
    await sleep(300)
    assert.equal(cloudEvents.requests(home).some((each) => each.device === closed.device), false, 'the Mac is closed and heard nothing')
    cloudEvents.start()
    for (let i = 0; i < 100 && !cloudEvents.requests(home).some((each) => each.device === closed.device); i++) await sleep(50)
    const shown = (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ workspaces: Array<{ id: string; requests: Array<{ device: string; name: string }> }> }>()
    assert.deepEqual(shown.workspaces.find((each) => each.id === home)?.requests.map(({ device, name }) => ({ device, name })), [{ device: closed.device, name: 'Firefox' }], 'reopened, the Mac shows the request it missed')
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
