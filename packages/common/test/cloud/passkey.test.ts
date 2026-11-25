import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPasskey } from '../../src/cloud/passkey.ts'
import { concat, sha256, toBase64 } from '../../src/vault/public.ts'

const ORIGIN = 'https://app.openhut.dev'

function der(raw: Uint8Array): Uint8Array {
  const int = (part: Uint8Array) => {
    let at = 0
    while (at < part.length - 1 && part[at] === 0) at++
    const trimmed = part.subarray(at)
    return trimmed[0] & 0x80 ? concat([new Uint8Array([0]), trimmed]) : trimmed
  }
  const [r, s] = [int(raw.subarray(0, 32)), int(raw.subarray(32))]
  return concat([new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s])
}

async function signed({ challenge, origin = ORIGIN, flags = 0x05 }: { challenge: string; origin?: string; flags?: number }) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }))
  const auth = concat([await sha256(new TextEncoder().encode('app.openhut.dev')), new Uint8Array([flags, 0, 0, 0, 1])])
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, concat([auth, await sha256(clientData)])))
  return { publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))), assertion: { clientData: toBase64(clientData), authenticatorData: toBase64(auth), signature: toBase64(der(raw)) } }
}

test('a Touch ID assertion checks only for its passkey, this knock’s challenge, our origin and a verified user', async () => {
  const good = await signed({ challenge: 'knock-commit' })
  assert.equal(await checkPasskey({ ...good, challenge: 'knock-commit', origin: ORIGIN }), true)
  assert.equal(await checkPasskey({ ...good, challenge: 'another-knock', origin: ORIGIN }), false)
  assert.equal(await checkPasskey({ ...good, publicKey: (await signed({ challenge: 'x' })).publicKey, challenge: 'knock-commit', origin: ORIGIN }), false)
  const elsewhere = await signed({ challenge: 'knock-commit', origin: 'https://evil.example' })
  assert.equal(await checkPasskey({ ...elsewhere, challenge: 'knock-commit', origin: ORIGIN }), false)
  const unverified = await signed({ challenge: 'knock-commit', flags: 0x01 })
  assert.equal(await checkPasskey({ ...unverified, challenge: 'knock-commit', origin: ORIGIN }), false)
})
