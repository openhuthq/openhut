import Noise, { type Curve, type KeyPair } from 'noise-handshake'
import Cipher from 'noise-handshake/cipher.js'
import curve from 'noise-handshake/dh.js'

export type DeviceKey = { publicKey: Uint8Array; agree?: (remote: Uint8Array) => Promise<Uint8Array>; secretKey?: Uint8Array }
export type ComputerKey = { publicKey: Uint8Array; secretKey: Uint8Array }
export type Transport = {
  encrypt: (plaintext: Uint8Array) => Uint8Array
  decrypt: (ciphertext: Uint8Array) => Uint8Array
  handshakeHash: Uint8Array
  remoteKey: Uint8Array
}
type Options = { prologue?: Uint8Array; ephemeral?: Uint8Array }

const empty = new Uint8Array(0)

export function generateKeyPair(): ComputerKey {
  return curve.generateKeyPair()
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('This is not lowercase hex.')
  return Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16))
}

function nativeCurve(key: DeviceKey): { pair: KeyPair; curve: Curve; prepare: (remote: Uint8Array) => Promise<void> } {
  const { secretKey, agree } = key
  if (secretKey) return { pair: { publicKey: key.publicKey, secretKey }, curve, prepare: async () => {} }
  if (!agree) throw new Error('A device key needs a secret key or an agree function.')
  const pair = { publicKey: key.publicKey }
  const cache = new Map<string, Uint8Array>()
  const dh = (remote: Uint8Array, local: KeyPair) => {
    if (local !== pair) return curve.dh(remote, local)
    const shared = cache.get(toHex(remote))
    if (!shared) throw new Error('The device key has not agreed with this key yet.')
    return shared
  }
  const prepare = async (remote: Uint8Array) => {
    cache.set(toHex(remote), await agree(remote))
  }
  return { pair, curve: { ...curve, dh }, prepare }
}

function transport(state: Noise): Transport {
  if (!state.tx || !state.rx || !state.hash || !state.rs) throw new Error('The handshake has not finished.')
  const send = new Cipher(state.tx)
  const receive = new Cipher(state.rx)
  return {
    encrypt: plaintext => send.encrypt(plaintext),
    decrypt: ciphertext => receive.decrypt(ciphertext),
    handshakeHash: state.hash,
    remoteKey: Uint8Array.from(state.rs)
  }
}

export function initiator(input: { key: DeviceKey; remote: Uint8Array } & Options) {
  const { pair, curve: dh, prepare } = nativeCurve(input.key)
  const state = new Noise('IK', true, pair, { curve: dh })
  state.initialise(input.prologue ?? empty, input.remote)
  if (input.ephemeral) state.e = dh.generateKeyPair(input.ephemeral)
  return {
    write: async (payload: Uint8Array = empty) => {
      await prepare(input.remote)
      return state.send(payload)
    },
    read: async (message: Uint8Array) => {
      if (message.byteLength < 48) throw new Error('The handshake reply is too short.')
      await prepare(message.subarray(0, 32))
      const payload = state.recv(Uint8Array.from(message))
      return { payload, transport: transport(state) }
    }
  }
}

export function responder(input: { key: ComputerKey } & Options) {
  const state = new Noise('IK', false, input.key)
  state.initialise(input.prologue ?? empty)
  if (input.ephemeral) state.e = curve.generateKeyPair(input.ephemeral)
  return {
    read: (message: Uint8Array) => state.recv(Uint8Array.from(message)),
    write: (payload: Uint8Array = empty) => {
      const message = state.send(payload)
      return { message, transport: transport(state) }
    }
  }
}

async function hmacKey({ secret, usage }: { secret: string; usage: 'sign' | 'verify' }) {
  return crypto.subtle.importKey('raw', fromHex(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

export async function pairingProof({ secret, handshakeHash }: { secret: string; handshakeHash: Uint8Array }): Promise<string> {
  const key = await hmacKey({ secret, usage: 'sign' })
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.from(handshakeHash))))
}

export async function verifyProof({ secret, handshakeHash, proof }: { secret: string; handshakeHash: Uint8Array; proof: string }): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(proof)) return false
  const key = await hmacKey({ secret, usage: 'verify' })
  return crypto.subtle.verify('HMAC', key, fromHex(proof), Uint8Array.from(handshakeHash))
}

export async function sixDigits(handshakeHash: Uint8Array): Promise<string> {
  const hash = new DataView(await crypto.subtle.digest('SHA-256', Uint8Array.from(handshakeHash)))
  return String(hash.getUint32(0) % 1_000_000).padStart(6, '0')
}
