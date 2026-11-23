import { createHash } from 'node:crypto'
import { FACES } from './cloud.ts'

export function commitOf({ device, nonce }: { device: string; nonce: string }): string {
  return createHash('sha256').update(`${device}.${nonce}`).digest('base64url')
}

export function facesOf({ device, nonce }: { device: string; nonce: string }): number[] {
  const bytes = createHash('sha256').update(`faces.${device}.${nonce}`).digest()
  const first = bytes[0] % FACES
  const second = (first + 1 + (bytes[1] % (FACES - 1))) % FACES
  return [first, second].sort((a, b) => a - b)
}
