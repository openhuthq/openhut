import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, type webcrypto } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { FACES } from '@openhut/common/cloud/cloud.ts'
import { commitOf, facesOf } from '@openhut/common/cloud/faces.ts'
import { proofOf, requestParts, SIGNATURE_HEADER, type Session } from '@openhut/common/cloud/v1/identity.ts'
import { toBase64 } from '@openhut/common/vault/vault.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const WEB = 'https://app.openhut.dev'

test('against the real cloud API: a knock is let in only with the right pair, user presence asked by the runtime, and within 15 minutes; a wrong pick turns it down for good', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { userPresence } = await import('../../../src/server/cloud/user-presence.ts')
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

    const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as webcrypto.CryptoKeyPair
    const tunnel = await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as webcrypto.CryptoKeyPair
    const raw = async (key: webcrypto.CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
    const device = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(tunnel.publicKey)]))
    const sign = async (bytes: Uint8Array) => toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, Uint8Array.from(bytes))))
    const api = (path: string, init: RequestInit = {}) => fetch(`${cloud.url}${path}`, { ...init, headers: { origin: WEB, 'content-type': 'application/json', ...init.headers } })
    const social = await (await api('/v1/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', device, redirectUrl: `${WEB}/signed-in`, state: 'knock-state-1' }) })).json() as { url: string }
    const code = new URL(await devSignIn({ authorizationUrl: social.url, email: 'mo@example.com' }), WEB).searchParams.get('code') ?? ''
    const session = await (await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ grant: 'google', code, signature: await sign(proofOf({ proof: 'session', parts: [code] })) }) })).json() as Session
    const signed = async (method: string, path: string, body = '') => {
      const signedAt = Date.now()
      return api(path, { method, body: body || undefined, headers: { authorization: `Bearer ${session.token}`, [SIGNATURE_HEADER]: `${signedAt}.${await sign(proofOf({ proof: 'request', parts: await requestParts({ method, path, signedAt, body }) }))}` } })
    }
    const url = `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(device)}`
    const knock = async () => {
      const nonce = randomBytes(32).toString('base64url')
      assert.equal((await signed('POST', '/v1/join-requests', JSON.stringify({ workspace: home, name: 'Chrome', os: 'web', commit: commitOf({ device, nonce }) }))).status, 200)
      await cloudEvents.refreshRequests(home)
      assert.equal((await app.inject({ method: 'POST', url: `${url}/reviews`, headers })).statusCode, 200)
      assert.equal((await signed('POST', '/v1/join-requests/nonces', JSON.stringify({ workspace: home, nonce }))).status, 200)
      await cloudEvents.refreshRequests(home)
      return facesOf({ device, nonce })
    }
    const approve = (faces: number[]) => app.inject({ method: 'POST', url: `${url}/approvals`, headers, payload: { faces } })

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
  } finally {
    await app.close()
    await cloud.close()
  }
})
