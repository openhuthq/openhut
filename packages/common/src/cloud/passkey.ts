import { concat, equal, fromBase64, sha256, subtle } from '../vault/public.ts'
import type { PasskeyAssertion } from './v1/trust.ts'

const USER_VERIFIED = 0x04

export async function checkPasskey({ publicKey, assertion, challenge, origin }: { publicKey: string; assertion: PasskeyAssertion; challenge: string; origin: string }): Promise<boolean> {
  const clientBytes = fromBase64(assertion.clientData)
  const auth = fromBase64(assertion.authenticatorData)
  const client = parsed(new TextDecoder().decode(clientBytes))
  if (client?.type !== 'webauthn.get' || client.challenge !== challenge || client.origin !== origin) return false
  const rpId = new TextEncoder().encode(new URL(origin).hostname)
  if (auth.length < 37 || !equal({ a: auth.subarray(0, 32), b: await sha256(rpId) }) || !(auth[32] & USER_VERIFIED)) return false
  const key = await subtle.importKey('spki', fromBase64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null)
  const signature = raw(fromBase64(assertion.signature))
  if (!key || !signature) return false
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, concat([auth, await sha256(clientBytes)]))
}

function parsed(text: string): { type?: string; challenge?: string; origin?: string } | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function raw(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der[0] !== 0x30 || der[2] !== 0x02) return null
  const rLength = der[3]
  const r = der.subarray(4, 4 + rLength)
  if (der[4 + rLength] !== 0x02) return null
  const s = der.subarray(6 + rLength, 6 + rLength + der[5 + rLength])
  const pad = (part: Uint8Array) => part.subarray(Math.max(0, part.length - 32))
  const out = new Uint8Array(64)
  out.set(pad(r), 32 - pad(r).length)
  out.set(pad(s), 64 - pad(s).length)
  return out
}

