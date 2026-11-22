import { createPublicKey, verify } from 'node:crypto'
import { basename } from 'node:path'

export const RELEASE_KEY = ''

export function cosigned({ manifest, signature, key, files }) {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' })
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(manifest), publicKey, Buffer.from(signature.trim(), 'base64'))) return false
    const signed = JSON.parse(manifest).files ?? {}
    return files.length > 0 && files.every((file) => typeof file.sha512 === 'string' && signed[basename(file.url)] === file.sha512)
  } catch {
    return false
  }
}
