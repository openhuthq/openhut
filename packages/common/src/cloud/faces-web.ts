import { toBase64 } from '../vault/vault.ts'
import { FACES } from './cloud.ts'

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export async function commitOfWeb({ device, nonce }: { device: string; nonce: string }): Promise<string> {
  return toBase64(await sha256(`${device}.${nonce}`))
}

export async function facesOfWeb({ device, nonce }: { device: string; nonce: string }): Promise<number[]> {
  const bytes = await sha256(`faces.${device}.${nonce}`)
  const first = bytes[0] % FACES
  const second = (first + 1 + (bytes[1] % (FACES - 1))) % FACES
  return [first, second].sort((a, b) => a - b)
}
