import * as z from 'zod/mini'
import { Timestamp } from '../../api.ts'
import { DeviceKey, Locked, Member, Role, Signature } from '../cloud.ts'
import { check, concat, field, fromBase64, sha256, sign, toBase64, type Bytes, type Identity } from '../../vault/vault.ts'

export const Email = Member.shape.email
export const WorkspaceId = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/, 'Send a workspace id of 8 to 64 base64url characters.'))
export const SignedAt = z.number().check(z.int(), z.minimum(0))
export const SIGNATURE_HEADER = 'openhut-signature'
export const SKEW_MS = 5 * 60_000

export const V1_PROOFS = ['session', 'refresh', 'request', 'key-box'] as const
export type V1Proof = (typeof V1_PROOFS)[number]

export function proofOf({ proof, parts }: { proof: V1Proof; parts: string[] }): Bytes {
  return concat([new TextEncoder().encode(`openhut/v1/${proof}\0`), ...parts.map(field)])
}

export async function signV1({ signer, proof, parts }: { signer: Identity; proof: V1Proof; parts: string[] }): Promise<string> {
  return toBase64(await sign({ secret: signer.secret, bytes: proofOf({ proof, parts }) }))
}

export async function checkV1({ device, proof, parts, signature }: { device: string; proof: V1Proof; parts: string[]; signature: string }): Promise<boolean> {
  if (!DeviceKey.safeParse(device).success || !Signature.safeParse(signature).success) return false
  return check({ publicKey: fromBase64(device), bytes: proofOf({ proof, parts }), signature: fromBase64(signature) })
}

export async function bodyHash(body: Uint8Array | string): Promise<string> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body)
  return toBase64(await sha256(bytes))
}

export async function requestParts({ method, path, signedAt, body }: { method: string; path: string; signedAt: number; body: Uint8Array | string }): Promise<string[]> {
  return [method.toUpperCase(), path, String(signedAt), await bodyHash(body)]
}

export async function signRequest({ signer, method, path, body = '', signedAt = Date.now() }: { signer: Identity; method: string; path: string; body?: Uint8Array | string; signedAt?: number }): Promise<string> {
  return `${signedAt}.${await signV1({ signer, proof: 'request', parts: await requestParts({ method, path, signedAt, body }) })}`
}

export const CreateSession = z.discriminatedUnion('grant', [
  z.object({ grant: z.literal('google'), code: z.string().check(z.maxLength(100)), signature: Signature }),
  z.object({ grant: z.literal('join_code'), code: z.string().check(z.maxLength(100)), device: DeviceKey, signature: Signature }),
  z.object({ grant: z.literal('refresh_token'), refreshToken: z.string().check(z.maxLength(200)), signedAt: SignedAt, signature: Signature }),
])
export type CreateSession = z.infer<typeof CreateSession>

export const Session = z.object({ object: z.literal('session'), token: z.string(), refreshToken: z.string(), sub: z.string(), email: Email, device: DeviceKey, expiresAt: Timestamp })
export type Session = z.infer<typeof Session>

export const JoinCode = z.object({ object: z.literal('join_code'), code: z.string(), expiresAt: Timestamp })
export type JoinCode = z.infer<typeof JoinCode>

export const DEVICE_KINDS = ['computer', 'runtime', 'viewer', 'kit'] as const
export const DeviceKind = z.enum(DEVICE_KINDS)
export type DeviceKind = z.infer<typeof DeviceKind>
export const ACCESS = ['listed', 'kit', 'waiting'] as const

export const Me = z.object({
  object: z.literal('me'),
  sub: z.string(),
  email: Email,
  device: DeviceKey,
  home: z.nullable(WorkspaceId),
  workspaces: z.array(z.object({ id: WorkspaceId, object: z.literal('workspace'), role: Role, access: z.enum(ACCESS), kind: z.nullable(DeviceKind), version: z.number() })),
})
export type Me = z.infer<typeof Me>

export const KEY_BOX_NAME = /^(passkey|kit|kit-confirmed|workspace-[A-Za-z0-9_-]{8,64})$/
export const KeyBoxName = z.string().check(z.regex(KEY_BOX_NAME, 'Name a key box passkey, kit, kit-confirmed or workspace-<id>.'))
export const PutKeyBox = z.object({ body: Locked.check(z.maxLength(16_384)), by: DeviceKey, signature: Signature, savedAt: z.number().check(z.int(), z.positive()) })
export type PutKeyBox = z.infer<typeof PutKeyBox>
export const NamedKeyBox = z.object({ name: KeyBoxName, ...PutKeyBox.shape })
export type NamedKeyBox = z.infer<typeof NamedKeyBox>
export const DeleteKeyBox = z.object({ by: DeviceKey, signature: Signature })
export type DeleteKeyBox = z.infer<typeof DeleteKeyBox>
export const KeyBox = z.object({ id: KeyBoxName, object: z.literal('key_box'), body: Locked, by: DeviceKey, signature: Signature, savedAt: Timestamp })
export type KeyBox = z.infer<typeof KeyBox>

export function keyBoxParts({ sub, name, body, savedAt }: { sub: string; name: string; body: string; savedAt: number }): string[] {
  return [sub, name, body, String(savedAt)]
}
