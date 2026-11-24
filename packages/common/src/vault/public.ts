import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core'

export type Bytes = Uint8Array<ArrayBuffer>
export type Identity = { secret: Bytes; publicKey: Bytes }
export type Suite = { hpke: CipherSuite; enc: number; aead: 'AES-GCM'; hash: 'SHA-256'; nonce: number; tag: number }

export const LETTER_PURPOSES = ['workspace-key', 'account-key', 'connection-key', 'invite', 'pairing'] as const
export type LetterPurpose = (typeof LETTER_PURPOSES)[number]

export const FORMAT = 1
export const HEADER = 6
export const SIGNATURE = 64
export const KEY = 32
const UINT32 = 0xffffffff

export const deviceKem = new DhkemX25519HkdfSha256()
export const suites: Record<number, Suite> = {
  1: { hpke: new CipherSuite({ kem: deviceKem, kdf: new HkdfSha256(), aead: new Aes256Gcm() }), enc: 32, aead: 'AES-GCM', hash: 'SHA-256', nonce: 12, tag: 16 },
}
export const NEWEST = 1

export const subtle = globalThis.crypto.subtle
export const text = new TextEncoder()
const ED25519_PKCS8 = fromHex('302e020100300506032b657004220420')
const SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
].map(fromHex)

export function newKey(length = KEY): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function header({ suite = NEWEST, version }: { suite?: number; version: number }): Bytes | null {
  if (!suites[suite] || !Number.isInteger(version) || version < 0 || version > UINT32) return null
  const bytes = new Uint8Array(HEADER)
  bytes[0] = FORMAT
  bytes[1] = suite
  new DataView(bytes.buffer).setUint32(2, version)
  return bytes
}

export function readHeader(bytes: Uint8Array): { suite: number; version: number } | null {
  if (bytes.length < HEADER || bytes[0] !== FORMAT || !suites[bytes[1]]) return null
  return { suite: bytes[1], version: new DataView(bytes.buffer, bytes.byteOffset).getUint32(2) }
}

export function isLocked(bytes: Uint8Array): boolean {
  const head = readHeader(bytes)
  return head !== null && bytes.length >= HEADER + suites[head.suite].nonce + suites[head.suite].tag
}

export async function identity(secret: Bytes = newKey()): Promise<Identity> {
  const signing = await subtle.importKey('pkcs8', concat([ED25519_PKCS8, secret]), 'Ed25519', true, ['sign'])
  const { x } = await subtle.exportKey('jwk', signing)
  const box = await deviceKem.deriveKeyPair(secret)
  const boxPublic = new Uint8Array(await deviceKem.serializePublicKey(box.publicKey))
  return { secret, publicKey: concat([fromBase64(x || ''), boxPublic]) }
}

export async function boxKey(secret: Bytes): Promise<{ publicKey: Bytes; secretKey: Bytes }> {
  const box = await deviceKem.deriveKeyPair(secret)
  return { publicKey: new Uint8Array(await deviceKem.serializePublicKey(box.publicKey)), secretKey: new Uint8Array(await deviceKem.serializePrivateKey(box.privateKey)) }
}

export async function sign({ secret, bytes }: { secret: Bytes; bytes: Bytes }): Promise<Bytes> {
  const key = await subtle.importKey('pkcs8', concat([ED25519_PKCS8, secret]), 'Ed25519', false, ['sign'])
  return new Uint8Array(await subtle.sign('Ed25519', key, bytes))
}

export async function check({ publicKey, bytes, signature }: { publicKey: Bytes; bytes: Bytes; signature: Bytes }): Promise<boolean> {
  if (publicKey.length !== 64 || signature.length !== SIGNATURE || smallOrder(publicKey) || smallOrder(signature)) return false
  const key = await subtle.importKey('raw', publicKey.slice(0, 32), 'Ed25519', false, ['verify'])
  return subtle.verify('Ed25519', key, signature, bytes)
}

function smallOrder(point: Uint8Array): boolean {
  return SMALL_ORDER.some((bad) => bad.every((byte, index) => byte === (index === 31 ? point[index] & 0x7f : point[index])))
}

export async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle.digest('SHA-256', bytes))
}

export function field(value: string): Bytes {
  const bytes = text.encode(value)
  const out = new Uint8Array(4 + bytes.length)
  new DataView(out.buffer).setUint32(0, bytes.length)
  out.set(bytes, 4)
  return out
}

export function concat(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0)
  return out
}

export function equal({ a, b }: { a: Uint8Array; b: Uint8Array }): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64(value: string): Bytes {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0))
}

function fromHex(hex: string): Bytes {
  return Uint8Array.from(hex.match(/../g) || [], (pair) => Number.parseInt(pair, 16))
}
