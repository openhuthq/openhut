import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { commitOfWeb } from '@openhut/common/cloud/faces-web.ts'
import { concat, sha256, toBase64 } from '@openhut/common/vault/public.ts'
import { bootCloud, devSignIn, hasCloud, webBrowser } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'
const WEB = 'https://app.openhut.dev'

async function touchId(challenge: string, signer: CryptoKey) {
  const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: WEB }))
  const authenticatorData = concat([await sha256(new TextEncoder().encode(new URL(WEB).hostname)), new Uint8Array([0x05, 0, 0, 0, 1])])
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, concat([authenticatorData, await sha256(clientData)])))
  const int = (part: Uint8Array) => part[0] & 0x80 ? concat([new Uint8Array([0]), part]) : part
  const [r, s] = [int(raw.subarray(0, 32)), int(raw.subarray(32))]
  const signature = concat([new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s])
  return { clientData: toBase64(clientData), authenticatorData: toBase64(authenticatorData), signature: toBase64(signature) }
}

test('against the real cloud API: an own browser with a valid Touch ID assertion is approved without faces; an invalid one falls back', { skip }, async () => {
  const booted = await bootCloud({ managed: true })
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
  const { memberOf, tunnelKeyOf } = await import('../../../src/server/team/identity.ts')
  await migrate()
  const app = Fastify()
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const passkey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    await cloudService.prepareEncryption()
    await cloudService.encryptionPasskey({ id: 'cred', publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', passkey.publicKey))) })
    await cloudService.encryption({ on: true })
    const home = keysService.mustBeOn().workspace.id

    const browser = await webBrowser({ url: booted.url, email: 'mo@example.com' })
    const knock = async (nonce: string, signer: CryptoKey) => {
      await browser.client.knock({ team: home, nonce }).ask({ name: 'Chrome', os: 'web', passkey: await touchId(await commitOfWeb({ device: browser.device, nonce }), signer) })
      await cloudEvents.refreshRequests(home)
      for (let i = 0; i < 40 && !memberOf(tunnelKeyOf(browser.device)); i++) await sleep(50).then(() => roomKeys.refresh({ ws: home }))
    }

    await knock('a'.repeat(43), stranger.privateKey)
    assert.equal(memberOf(tunnelKeyOf(browser.device)), undefined, 'a passkey we don’t know lets nobody in')
    assert.equal(cloudEvents.requests(home)[0]?.checked, true, 'the knock still waits for faces')

    await knock('b'.repeat(43), passkey.privateKey)
    assert.equal(memberOf(tunnelKeyOf(browser.device))?.own, true, 'Touch ID lets your own browser in, no faces')
  } finally {
    await app.close()
    await booted.close()
  }
})
