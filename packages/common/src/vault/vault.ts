import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core'
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

export type Bytes = Uint8Array<ArrayBuffer>
export type Identity = { secret: Bytes; publicKey: Bytes }

export const FORMAT = 1
export const HEADER = 6
const NONCE = 12
const TAG = 16
const ENC = 32
const SIGNATURE = 64

const suites: Record<number, { hpke: CipherSuite }> = {
  1: { hpke: new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() }) },
}
export const NEWEST = 1

const subtle = globalThis.crypto.subtle
const text = new TextEncoder()
const ED25519_PKCS8 = fromHex('302e020100300506032b657004220420')

export function newKey(length = 32): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function header({ suite = NEWEST, version }: { suite?: number; version: number }): Bytes {
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
  return readHeader(bytes) !== null && bytes.length >= HEADER + NONCE + TAG
}

export async function lock({ key, version, bind, plain }: { key: Bytes; version: number; bind: string; plain: Bytes }): Promise<Bytes> {
  const head = header({ version })
  const nonce = newKey(NONCE)
  const aes = await recordKey({ key, nonce, bind })
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: concat(head, text.encode(bind)) }, aes, plain)
  return concat(head, nonce, new Uint8Array(sealed))
}

export async function unlock({ keys, bind, locked }: { keys: Record<number, Bytes>; bind: string; locked: Bytes }): Promise<Bytes | null> {
  const head = readHeader(locked)
  const key = head && keys[head.version]
  if (!key || !isLocked(locked)) return null
  const nonce = locked.slice(HEADER, HEADER + NONCE)
  const aes = await recordKey({ key, nonce, bind })
  const additionalData = concat(locked.slice(0, HEADER), text.encode(bind))
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData }, aes, locked.slice(HEADER + NONCE)).catch(() => null)
  return plain && new Uint8Array(plain)
}

export async function identity(secret: Bytes = newKey()): Promise<Identity> {
  const signing = await subtle.importKey('pkcs8', concat(ED25519_PKCS8, secret), 'Ed25519', true, ['sign'])
  const { x } = await subtle.exportKey('jwk', signing)
  const box = await suites[NEWEST].hpke.kem.deriveKeyPair(secret)
  const boxPublic = new Uint8Array(await suites[NEWEST].hpke.kem.serializePublicKey(box.publicKey))
  return { secret, publicKey: concat(fromBase64(x ?? ''), boxPublic) }
}

export async function sign({ secret, bytes }: { secret: Bytes; bytes: Bytes }): Promise<Bytes> {
  const key = await subtle.importKey('pkcs8', concat(ED25519_PKCS8, secret), 'Ed25519', false, ['sign'])
  return new Uint8Array(await subtle.sign('Ed25519', key, bytes))
}

export async function check({ publicKey, bytes, signature }: { publicKey: Bytes; bytes: Bytes; signature: Bytes }): Promise<boolean> {
  if (publicKey.length !== 64 || signature.length !== SIGNATURE) return false
  const key = await subtle.importKey('raw', publicKey.slice(0, 32), 'Ed25519', false, ['verify']).catch(() => null)
  return key ? subtle.verify('Ed25519', key, signature, bytes) : false
}

export async function letter({ sender, to, workspace, version, plain }: { sender: Identity; to: Bytes; workspace: string; version: number; plain: Bytes }): Promise<Bytes> {
  const head = header({ version })
  const context = letterContext({ head, from: sender.publicKey, to, workspace })
  const signature = await sign({ secret: sender.secret, bytes: concat(context, plain) })
  const { hpke } = suites[NEWEST]
  const senderKey = await hpke.kem.deriveKeyPair(sender.secret)
  const recipientPublicKey = await hpke.kem.deserializePublicKey(to.slice(32))
  const { ct, enc } = await hpke.seal({ recipientPublicKey, senderKey, info: context }, concat(signature, plain), context)
  return concat(head, new Uint8Array(enc), new Uint8Array(ct))
}

export async function read({ recipient, from, workspace, body, allowed }: { recipient: Identity; from: Bytes; workspace: string; body: Bytes; allowed: Bytes[] }): Promise<Bytes | null> {
  const head = readHeader(body)
  if (!head || body.length < HEADER + ENC + SIGNATURE + TAG || from.length !== 64) return null
  if (!allowed.some((key) => equal(key, from))) return null
  const context = letterContext({ head: body.slice(0, HEADER), from, to: recipient.publicKey, workspace })
  const { hpke } = suites[head.suite]
  const recipientKey = await hpke.kem.deriveKeyPair(recipient.secret)
  const senderPublicKey = await hpke.kem.deserializePublicKey(from.slice(32)).catch(() => null)
  if (!senderPublicKey) return null
  const enc = body.slice(HEADER, HEADER + ENC)
  const opened = await hpke.open({ recipientKey, senderPublicKey, enc, info: context }, body.slice(HEADER + ENC), context).catch(() => null)
  if (!opened) return null
  const signature = new Uint8Array(opened.slice(0, SIGNATURE))
  const plain = new Uint8Array(opened.slice(SIGNATURE))
  return (await check({ publicKey: from, bytes: concat(context, plain), signature })) ? plain : null
}

function letterContext({ head, from, to, workspace }: { head: Bytes; from: Bytes; to: Bytes; workspace: string }): Bytes {
  return concat(text.encode('openhut/letter\0'), head, from, to, text.encode(workspace))
}

export async function newWords(): Promise<{ words: string[]; key: Bytes }> {
  const entropy = newKey(16)
  return { words: entropyToMnemonic(entropy, wordlist).split(' '), key: await derive({ key: entropy, info: 'openhut/kit' }) }
}

export async function fromWords(words: string[]): Promise<Bytes | null> {
  const phrase = words.map((word) => word.trim().toLowerCase()).join(' ')
  if (words.length !== 12 || !validateMnemonic(phrase, wordlist)) return null
  return derive({ key: new Uint8Array(mnemonicToEntropy(phrase, wordlist)), info: 'openhut/kit' })
}

export async function commit(publicKey: Bytes): Promise<{ commitment: Bytes; nonce: Bytes }> {
  const nonce = newKey()
  return { commitment: await sha256(concat(text.encode('openhut/commit\0'), publicKey, nonce)), nonce }
}

export async function pairingCode({ commitment, nonce, newDevice, oldDevice }: { commitment: Bytes; nonce: Bytes; newDevice: Bytes; oldDevice: Bytes }): Promise<string | null> {
  const expected = await sha256(concat(text.encode('openhut/commit\0'), newDevice, nonce))
  if (!equal(expected, commitment)) return null
  const hash = await sha256(concat(text.encode('openhut/code\0'), commitment, newDevice, oldDevice, nonce))
  return String(new DataView(hash.buffer).getUint32(0) % 1_000_000).padStart(6, '0')
}

export async function slot({ key, path }: { key: Bytes; path: string }): Promise<string> {
  const hmac = await subtle.importKey('raw', await derive({ key, info: 'openhut/slot' }), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64(new Uint8Array(await subtle.sign('HMAC', hmac, text.encode(path))))
}

export async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle.digest('SHA-256', bytes))
}

async function recordKey({ key, nonce, bind }: { key: Bytes; nonce: Bytes; bind: string }): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: nonce, info: text.encode(`openhut/lock\0${bind}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function derive({ key, info }: { key: Bytes; info: string }): Promise<Bytes> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: text.encode(info) }, base, 256))
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0)
  return out
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64(value: string): Bytes {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0))
}

function fromHex(hex: string): Bytes {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}
