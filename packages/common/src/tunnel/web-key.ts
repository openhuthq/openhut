import type { DeviceKey } from './noise.ts'

const X25519 = { name: 'X25519' }

export type WebKeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }

export function newWebKeyPair(): Promise<WebKeyPair> {
  return crypto.subtle.generateKey(X25519, false, ['deriveBits']) as Promise<WebKeyPair>
}

export async function webKey(pair: WebKeyPair): Promise<DeviceKey> {
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    agree: async remote => {
      const peer = await crypto.subtle.importKey('raw', Uint8Array.from(remote), X25519, false, [])
      return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, pair.privateKey, 256))
    }
  }
}
