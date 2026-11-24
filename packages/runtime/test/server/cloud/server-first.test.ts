import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { webcrypto } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { commitOf } from '@openhut/common/cloud/faces.ts'
import type { JoinRequest } from '@openhut/common/cloud/v1/trust.ts'
import { proofOf, requestParts, SIGNATURE_HEADER, type JoinCode, type Me, type Session } from '@openhut/common/cloud/v1/identity.ts'
import { toBase64 } from '@openhut/common/vault/vault.ts'
import { bootCloud, devSignIn, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const WEB = 'https://app.openhut.dev'

test('against the real cloud API: a browser on an account with no computer makes a join code, the server that runs it becomes the first computer, and it lets that browser in when it knocks', { skip }, async () => {
  const cloud = await bootCloud()
  const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as webcrypto.CryptoKeyPair
  const box = await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as webcrypto.CryptoKeyPair
  const raw = async (key: webcrypto.CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const device = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
  const sign = async (bytes: Uint8Array) => toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, Uint8Array.from(bytes))))
  const api = (path: string, init: RequestInit = {}) => fetch(`${cloud.url}${path}`, { ...init, headers: { origin: WEB, 'content-type': 'application/json', ...init.headers } })
  const social = await (await api('/v1/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', device, redirectUrl: `${WEB}/signed-in`, state: 'first-run' }) })).json() as { url: string }
  const code = new URL(await devSignIn({ authorizationUrl: social.url, email: 'sara@example.com' }), WEB).searchParams.get('code') ?? ''
  const session = await (await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ grant: 'google', code, signature: await sign(proofOf({ proof: 'session', parts: [code] })) }) })).json() as Session
  const signed = async <T>(method: string, path: string, body = ''): Promise<T> => {
    const signedAt = Date.now()
    const res = await api(path, { method, body: body || undefined, headers: { authorization: `Bearer ${session.token}`, ...method !== 'GET' && { [SIGNATURE_HEADER]: `${signedAt}.${await sign(proofOf({ proof: 'request', parts: await requestParts({ method, path, signedAt, body }) }))}` } } })
    return res.json() as Promise<T>
  }
  const me = () => signed<Me>('GET', '/v1/me')
  assert.deepEqual((await me()).workspaces, [])
  const join = await signed<JoinCode>('POST', '/v1/join-codes')
  process.env.OPENHUT_JOIN = join.code

  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  await migrate()
  try {
    cloudService.connect()
    for (let i = 0; i < 100 && !keysService.account(); i++) await sleep(50)
    assert.equal(keysService.account()?.email, 'sara@example.com')
    const home = (await me()).home ?? ''
    assert.deepEqual((await me()).workspaces.map((each) => [each.id, each.access]), [[home, 'waiting']])

    const nonce = 'n'.repeat(43)
    await signed('POST', '/v1/join-requests', JSON.stringify({ workspace: home, name: 'Chrome (web)', os: 'web', commit: commitOf({ device, nonce }) }))
    const mine = async () => (await signed<{ data: JoinRequest[] }>('GET', `/v1/join-requests?workspace=${home}`)).data.find((each) => each.id === device)
    for (let i = 0; i < 100 && !(await mine())?.reviewed; i++) await sleep(100)
    await signed('POST', '/v1/join-requests/nonces', JSON.stringify({ workspace: home, nonce }))
    for (let i = 0; i < 100 && (await me()).workspaces[0]?.access !== 'listed'; i++) await sleep(100)
    assert.equal((await me()).workspaces[0]?.access, 'listed')
  } finally {
    cloudEvents.stop()
    await cloud.close()
  }
})
