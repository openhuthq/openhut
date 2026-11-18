import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

const Key = z.string().check(z.regex(/^[0-9a-f]{64}$/, 'Write keys as 64 lowercase hex characters.'))

export const Client = z.object({ key: Key, name: z.string().check(z.minLength(1), z.maxLength(100)), addedAt: Timestamp })
export type Client = z.infer<typeof Client>

export const AccessComputer = z.object({ id: Key, name: z.string().check(z.minLength(1), z.maxLength(100)), key: Key })
export type AccessComputer = z.infer<typeof AccessComputer>

export const Access = z.object({
  object: z.literal('access'),
  owner: Key,
  version: z.number().check(z.int(), z.minimum(1)),
  clients: z.array(Client).check(z.maxLength(100)),
  computers: z.array(AccessComputer).check(z.maxLength(100)),
  signature: z.string().check(z.regex(/^[0-9a-f]{128}$/, 'Sign the list with the owner\'s Ed25519 key, as 128 hex characters.')),
})
export type Access = z.infer<typeof Access>
export type Unsigned = Omit<Access, 'signature'>

export function canonical(access: Unsigned): string {
  const { signature: _signature, ...rest }: Unsigned & { signature?: string } = access
  return sorted(rest)
}

export async function verify(access: Access): Promise<boolean> {
  const message = new TextEncoder().encode(canonical(access))
  const key = await crypto.subtle.importKey('raw', bytesOf(access.owner), 'Ed25519', false, ['verify']).catch(() => null)
  if (key) return crypto.subtle.verify('Ed25519', key, bytesOf(access.signature), message)
  const { default: sodium } = await import('sodium-javascript')
  return sodium.crypto_sign_verify_detached(bytesOf(access.signature), message, bytesOf(access.owner))
}

export async function computerId(key: string): Promise<string> {
  return hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(key))))
}

export function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesOf(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

function sorted(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sorted).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, each]) => `${JSON.stringify(key)}:${sorted(each)}`).join(',')}}`
  return JSON.stringify(value)
}
