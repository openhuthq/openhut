import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scrypt, timingSafeEqual, type KeyObject } from 'node:crypto'
import { config } from './config.ts'
import { db } from './db.ts'

// The app passes the root secret from the system keychain; without a keychain it lives in the database.
const stored = config.secret ? undefined : (await db.selectFrom('install_setting').select('value').where('name', '=', 'auth_secret').executeTakeFirst())?.value
const secretHex = config.secret ?? stored ?? randomBytes(32).toString('hex')
if (!config.secret && !stored) await db.insertInto('install_setting').values({ name: 'auth_secret', value: secretHex }).execute()
const secret = Buffer.from(secretHex, 'hex')
const sealKey = createHash('sha256').update(secret).update('seal').digest()
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI_BYTES = 44
const transferKey = createPrivateKey({ key: Buffer.concat([X25519_PKCS8, createHash('sha256').update(secret).update('transfer').digest()]), format: 'der', type: 'pkcs8' })
export const transferPublicKey = createPublicKey(transferKey).export({ format: 'der', type: 'spki' }).toString('base64')

export function seal(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey, iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function unseal(sealed: string): string {
  const bytes = Buffer.from(sealed, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', sealKey, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
}

export const keyFor = (purpose: string): Buffer => createHash('sha256').update(secret).update(purpose).digest()
export const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase()}`
export const newToken = (prefix: string): string => `${prefix}_${randomBytes(24).toString('base64url')}`

export const sameSecret = ({ given, expected }: { given: string; expected: string }): boolean =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))

const DUMMY_HASH = `scrypt:${'0'.repeat(32)}:${'0'.repeat(64)}`

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${(await derive({ password, salt })).toString('hex')}`
}

export async function checkPassword({ password, stored }: { password: string; stored: string | null | undefined }): Promise<boolean> {
  const [, salt = '', hash = ''] = (stored ?? DUMMY_HASH).split(':')
  const got = await derive({ password, salt: Buffer.from(salt, 'hex') })
  return !!stored && got.length === hash.length / 2 && timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

const derive = ({ password, salt }: { password: string; salt: Buffer }): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 1 << 15, maxmem: 64 << 20 }, (err, key) => (err ? reject(err) : resolve(key))))

export const agentToken = ({ id, epoch }: { id: string; epoch: number }): string => `${id}.${createHmac('sha256', secret).update(epoch ? `${id}:${epoch}` : id).digest('hex')}`

export function sealFor({ publicKey, text }: { publicKey: string; text: string }): string {
  const ephemeral = generateKeyPairSync('x25519')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sharedKey({ privateKey: ephemeral.privateKey, publicKey: spki(Buffer.from(publicKey, 'base64')) }), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([ephemeral.publicKey.export({ format: 'der', type: 'spki' }), iv, cipher.getAuthTag(), body]).toString('base64')
}

export function openSealed(sealed: string): string {
  const bytes = Buffer.from(sealed, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', sharedKey({ privateKey: transferKey, publicKey: spki(bytes.subarray(0, SPKI_BYTES)) }), bytes.subarray(SPKI_BYTES, SPKI_BYTES + 12))
  decipher.setAuthTag(bytes.subarray(SPKI_BYTES + 12, SPKI_BYTES + 28))
  return Buffer.concat([decipher.update(bytes.subarray(SPKI_BYTES + 28)), decipher.final()]).toString('utf8')
}

const spki = (key: Buffer): KeyObject => createPublicKey({ key, format: 'der', type: 'spki' })

const sharedKey = ({ privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject }): Buffer =>
  Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey, publicKey }), '', 'openhut transfer', 32))
