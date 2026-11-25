import { createHash } from 'node:crypto'

export function commitOf({ device, nonce }: { device: string; nonce: string }): string {
  return createHash('sha256').update(`${device}.${nonce}`).digest('base64url')
}
