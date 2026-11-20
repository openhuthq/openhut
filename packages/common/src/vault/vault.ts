import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from '@hpke/core'
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

export type Bytes = Uint8Array<ArrayBuffer>
export type Identity = { secret: Bytes; publicKey: Bytes }
export type Suite = { hpke: CipherSuite; enc: number; aead: 'AES-GCM'; hash: 'SHA-256'; nonce: number; tag: number }
export type Pairing = { secret: string; fingerprint: string; hint: string }
export type PairingSide = 'new' | 'old'
export type PairTranscript = { secret: string; newDevice: Bytes; oldDevice: Bytes; workspace: string }

export const LETTER_PURPOSES = ['workspace-key', 'account-key', 'connection-key', 'invite', 'pairing'] as const
export type LetterPurpose = (typeof LETTER_PURPOSES)[number]

export const FORMAT = 1
export const HEADER = 6
const SIGNATURE = 64
const KEY = 32
const UINT32 = 0xffffffff
const PAIR_DIGITS = 20
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U'

const deviceKem = new DhkemX25519HkdfSha256()
export const suites: Record<number, Suite> = {
  1: { hpke: new CipherSuite({ kem: deviceKem, kdf: new HkdfSha256(), aead: new Aes256Gcm() }), enc: 32, aead: 'AES-GCM', hash: 'SHA-256', nonce: 12, tag: 16 },
}
export const NEWEST = 1

const subtle = globalThis.crypto.subtle
const text = new TextEncoder()
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

export async function lock({ key, version, bind, plain }: { key: Bytes; version: number; bind: string; plain: Bytes }): Promise<Bytes | null> {
  const head = header({ version })
  if (!head || key.length !== KEY) return null
  const suite = suites[NEWEST]
  const nonce = newKey(suite.nonce)
  const aes = await recordKey({ suite, key, nonce, bind })
  const sealed = await subtle.encrypt({ name: suite.aead, iv: nonce, additionalData: concat([head, text.encode(bind)]) }, aes, plain)
  return concat([head, nonce, new Uint8Array(sealed)])
}

export async function unlock({ keys, bind, locked }: { keys: Record<number, Bytes>; bind: string; locked: Bytes }): Promise<Bytes | null> {
  const head = readHeader(locked)
  const key = head && keys[head.version]
  if (!head || !key || !isLocked(locked)) return null
  const suite = suites[head.suite]
  const nonce = locked.slice(HEADER, HEADER + suite.nonce)
  const aes = await recordKey({ suite, key, nonce, bind }).catch(() => null)
  const additionalData = concat([locked.slice(0, HEADER), text.encode(bind)])
  const plain = aes && (await subtle.decrypt({ name: suite.aead, iv: nonce, additionalData }, aes, locked.slice(HEADER + suite.nonce)).catch(() => null))
  return plain ? new Uint8Array(plain) : null
}

export async function identity(secret: Bytes = newKey()): Promise<Identity> {
  const signing = await subtle.importKey('pkcs8', concat([ED25519_PKCS8, secret]), 'Ed25519', true, ['sign'])
  const { x } = await subtle.exportKey('jwk', signing)
  const box = await deviceKem.deriveKeyPair(secret)
  const boxPublic = new Uint8Array(await deviceKem.serializePublicKey(box.publicKey))
  return { secret, publicKey: concat([fromBase64(x ?? ''), boxPublic]) }
}

export async function sign({ secret, bytes }: { secret: Bytes; bytes: Bytes }): Promise<Bytes> {
  const key = await subtle.importKey('pkcs8', concat([ED25519_PKCS8, secret]), 'Ed25519', false, ['sign'])
  return new Uint8Array(await subtle.sign('Ed25519', key, bytes))
}

export async function check({ publicKey, bytes, signature }: { publicKey: Bytes; bytes: Bytes; signature: Bytes }): Promise<boolean> {
  if (publicKey.length !== 64 || signature.length !== SIGNATURE || smallOrder(publicKey) || smallOrder(signature)) return false
  const key = await subtle.importKey('raw', publicKey.slice(0, 32), 'Ed25519', false, ['verify']).catch(() => null)
  return key ? subtle.verify('Ed25519', key, signature, bytes) : false
}

function smallOrder(point: Uint8Array): boolean {
  return SMALL_ORDER.some((bad) => bad.every((byte, index) => byte === (index === 31 ? point[index] & 0x7f : point[index])))
}

export async function letter({ sender, to, workspace, purpose, version, plain }: { sender: Identity; to: Bytes; workspace: string; purpose: LetterPurpose; version: number; plain: Bytes }): Promise<Bytes | null> {
  const head = header({ version })
  if (!head) return null
  const context = letterContext({ head, from: sender.publicKey, to, purpose, workspace })
  const signature = await sign({ secret: sender.secret, bytes: concat([context, plain]) })
  const senderKey = await deviceKem.deriveKeyPair(sender.secret)
  const recipientPublicKey = await deviceKem.deserializePublicKey(to.slice(32))
  const { ct, enc } = await suites[NEWEST].hpke.seal({ recipientPublicKey, senderKey, info: context }, concat([signature, plain]), context)
  return concat([head, new Uint8Array(enc), new Uint8Array(ct)])
}

export async function read({ recipient, from, workspace, purpose, body, allowed }: { recipient: Identity; from: Bytes; workspace: string; purpose: LetterPurpose; body: Bytes; allowed: Bytes[] }): Promise<Bytes | null> {
  const head = readHeader(body)
  if (!head || !LETTER_PURPOSES.includes(purpose) || from.length !== 64) return null
  const { hpke, enc, tag } = suites[head.suite]
  if (body.length < HEADER + enc + SIGNATURE + tag || !allowed.some((key) => equal({ a: key, b: from }))) return null
  const context = letterContext({ head: body.slice(0, HEADER), from, to: recipient.publicKey, purpose, workspace })
  const recipientKey = await deviceKem.deriveKeyPair(recipient.secret)
  const senderPublicKey = await deviceKem.deserializePublicKey(from.slice(32)).catch(() => null)
  if (!senderPublicKey) return null
  const opened = await hpke.open({ recipientKey, senderPublicKey, enc: body.slice(HEADER, HEADER + enc), info: context }, body.slice(HEADER + enc), context).catch(() => null)
  if (!opened) return null
  const signature = new Uint8Array(opened.slice(0, SIGNATURE))
  const plain = new Uint8Array(opened.slice(SIGNATURE))
  return (await check({ publicKey: from, bytes: concat([context, plain]), signature })) ? plain : null
}

function letterContext({ head, from, to, purpose, workspace }: { head: Bytes; from: Bytes; to: Bytes; purpose: LetterPurpose; workspace: string }): Bytes {
  return concat([text.encode('openhut/letter\0'), head, from, to, field(purpose), field(workspace)])
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

export async function newPairing({ device, hint }: { device: Bytes; hint: string }): Promise<Pairing> {
  const secret = Array.from(newKey(PAIR_DIGITS), (byte) => CROCKFORD[byte & 31]).join('')
  return { secret, fingerprint: await fingerprint(device), hint }
}

export async function fingerprint(device: Bytes): Promise<string> {
  return toBase64(await sha256(concat([text.encode('openhut/device\0'), device])))
}

export function longCode(secret: string): string {
  return `${secret.match(/.{5}/g)?.join('-')}-${checkSymbol(secret)}`
}

export function fromLongCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replace(/[IL]/g, '1')
  const secret = code.slice(0, PAIR_DIGITS)
  return code.length === PAIR_DIGITS + 1 && isSecret(secret) && checkSymbol(secret) === code[PAIR_DIGITS] ? secret : null
}

export async function pairProof(input: PairTranscript & { side: PairingSide }): Promise<Bytes | null> {
  const bytes = pairBytes(input)
  return bytes && new Uint8Array(await subtle.sign('HMAC', await pairKey(input.secret), bytes))
}

export async function checkPairProof({ tag, ...input }: PairTranscript & { side: PairingSide; tag: Bytes }): Promise<boolean> {
  const bytes = pairBytes(input)
  return bytes !== null && isSecret(input.secret) && subtle.verify('HMAC', await pairKey(input.secret), tag, bytes)
}

export async function pairingWorkspace(transcript: PairTranscript): Promise<string | null> {
  const bytes = pairBytes({ ...transcript, side: 'letter' })
  return bytes && toBase64(new Uint8Array(await subtle.sign('HMAC', await pairKey(transcript.secret), bytes)))
}

function pairBytes({ side, newDevice, oldDevice, workspace }: PairTranscript & { side: PairingSide | 'letter' }): Bytes | null {
  if (newDevice.length !== 64 || oldDevice.length !== 64) return null
  return concat([text.encode('openhut/pair\0'), field(side), newDevice, oldDevice, field(workspace)])
}

async function pairKey(secret: string): Promise<CryptoKey> {
  return subtle.importKey('raw', await derive({ key: text.encode(secret), info: 'openhut/pair' }), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function isSecret(secret: string): boolean {
  return secret.length === PAIR_DIGITS && [...secret].every((char) => CROCKFORD.indexOf(char) >= 0 && CROCKFORD.indexOf(char) < 32)
}

function checkSymbol(secret: string): string {
  return CROCKFORD[[...secret].reduce((rest, char) => (rest * 32 + CROCKFORD.indexOf(char)) % 37, 0)]
}

export async function slot({ key, path }: { key: Bytes; path: string }): Promise<string> {
  const hmac = await subtle.importKey('raw', await derive({ key, info: 'openhut/slot' }), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64(new Uint8Array(await subtle.sign('HMAC', hmac, text.encode(path))))
}

export async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle.digest('SHA-256', bytes))
}

async function recordKey({ suite, key, nonce, bind }: { suite: Suite; key: Bytes; nonce: Bytes; bind: string }): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: suite.hash, salt: nonce, info: text.encode(`openhut/lock\0${bind}`) }, base, { name: suite.aead, length: 256 }, false, ['encrypt', 'decrypt'])
}

async function derive({ key, info }: { key: Bytes; info: string }): Promise<Bytes> {
  const base = await subtle.importKey('raw', key, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: text.encode(info) }, base, 256))
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
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}
