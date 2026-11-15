import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { db } from './db.ts'

const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(64)}`

await db.insertInto('install_setting').values({ name: 'auth_secret', value: randomBytes(32).toString('hex') })
  .onConflict((oc) => oc.column('name').doNothing()).execute()
const secret = Buffer.from((await db.selectFrom('install_setting').select('value').where('name', '=', 'auth_secret').executeTakeFirstOrThrow()).value, 'hex')
const sealKey = createHash('sha256').update(secret).update('seal').digest()

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

export const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
export const newId = (prefix: string): string => `${prefix}_${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase()}`
export const newToken = (prefix: string): string => `${prefix}_${randomBytes(24).toString('base64url')}`

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`
}

export async function checkPassword({ password, stored }: { password: string; stored: string | undefined }): Promise<boolean> {
  const [salt, hash] = (stored ?? DUMMY_HASH).split(':')
  const got = await derive(password, Buffer.from(salt, 'hex'))
  return stored !== undefined && timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

export const sameSecret = ({ given, expected }: { given: string; expected: string }): boolean =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))

export const agentToken = (agentId: string): string => `${agentId}.${createHmac('sha256', secret).update(agentId).digest('hex')}`

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key))))
}
