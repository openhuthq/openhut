import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { webcrypto } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { proofOf, requestParts, SIGNATURE_HEADER, type Session } from '@openhut/common/cloud/v1/identity.ts'
import { toBase64 } from '@openhut/common/vault/vault.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const WEB = 'https://app.openhut.dev'

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

    const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as webcrypto.CryptoKeyPair
    const tunnel = await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as webcrypto.CryptoKeyPair
    const raw = async (key: webcrypto.CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
    const device = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(tunnel.publicKey)]))
    const sign = async (bytes: Uint8Array) => toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, Uint8Array.from(bytes))))
    const api = (path: string, init: RequestInit = {}) => fetch(`${cloud.url}${path}`, { ...init, headers: { origin: WEB, 'content-type': 'application/json', ...init.headers } })

    const social = await (await api('/v1/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', device, redirectUrl: `${WEB}/signed-in`, state: 'web-state-1' }) })).json() as { url: string }
    const code = new URL(await devSignIn({ authorizationUrl: social.url, email: 'mo@example.com' }), WEB).searchParams.get('code') ?? ''
    const session = await (await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ grant: 'google', code, signature: await sign(proofOf({ proof: 'session', parts: [code] })) }) })).json() as Session
    const signed = async (method: string, path: string, body = '') => {
      const signedAt = Date.now()
      return api(path, { method, body: body || undefined, headers: { authorization: `Bearer ${session.token}`, [SIGNATURE_HEADER]: `${signedAt}.${await sign(proofOf({ proof: 'request', parts: await requestParts({ method, path, signedAt, body }) }))}` } })
    }
    assert.equal((await signed('POST', '/v1/join-requests', JSON.stringify({ workspace: home, name: 'Chrome', os: 'web' }))).status, 200)
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)

    await cloudEvents.refreshRequests(home)
    const approved = await app.inject({ method: 'POST', url: `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(device)}/approvals`, headers, payload: {} })
    assert.equal(approved.statusCode, 200, approved.body)
    assert.equal(memberOf(tunnelKeyOf(device))?.own, true)
    const letters = await signed('GET', `/v1/letters?workspace=${home}`)
    assert.deepEqual(((await letters.json()) as { data: unknown[] }).data, [])

    assert.equal((await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(device)}`, headers })).statusCode, 200)
    assert.equal(memberOf(tunnelKeyOf(device)), undefined)
  } finally {
    await app.close()
    await cloud.close()
  }
})
