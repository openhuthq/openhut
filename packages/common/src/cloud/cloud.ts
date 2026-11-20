import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { fromBase64, isLocked } from '../vault/vault.ts'

const base64 = /^[A-Za-z0-9_-]*$/

function bytesOf(value: string): Uint8Array | null {
  if (!base64.test(value) || value.length % 4 === 1) return null
  return fromBase64(value)
}

export const Base64 = z.string().check(z.maxLength(1_000_000), z.refine((value) => bytesOf(value) !== null, 'Send bytes as unpadded base64url.'))
export const Locked = z.string().check(
  z.maxLength(1_000_000),
  z.refine((value) => {
    const bytes = bytesOf(value)
    return bytes !== null && isLocked(bytes)
  }, 'Send the body locked by the vault, as base64url.'),
)
export const DeviceKey = z.string().check(z.regex(/^[A-Za-z0-9_-]{86}$/, 'Send a device key as 64 bytes of base64url.'))
const Signature = z.string().check(z.regex(/^[A-Za-z0-9_-]{86}$/, 'Send an Ed25519 signature as 64 bytes of base64url.'))
const Id = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/, 'Send an id of 8 to 64 base64url characters.'))
const Email = z.string().check(z.maxLength(320), z.regex(/^[^\sA-Z@]+@[^\sA-Z@]+$/, 'Send the email in lowercase.'))

export const RECORD_KINDS = ['agent', 'instructions', 'memory', 'skill', 'routine', 'connection', 'channel', 'thread', 'message', 'setting'] as const
export const RecordKind = z.enum(RECORD_KINDS)
export type RecordKind = z.infer<typeof RecordKind>

export const Record = z.object({
  id: Id,
  object: z.literal('record'),
  ver: z.number().check(z.int(), z.minimum(1)),
  seq: z.number().check(z.int(), z.minimum(0)),
  deleted: z.boolean(),
  body: Locked,
})
export type Record = z.infer<typeof Record>

export const Signed = z.object({ bytes: Base64, by: DeviceKey, signature: Signature })
export type Signed = z.infer<typeof Signed>

export const RecordBody = z.object({
  change: Id,
  kind: RecordKind,
  counter: z.number().check(z.int(), z.minimum(1)),
  value: z.unknown(),
})
export type RecordBody = z.infer<typeof RecordBody>

export const Letter = z.object({
  id: Id,
  object: z.literal('letter'),
  to: DeviceKey,
  from: DeviceKey,
  workspace: Id,
  body: Locked,
})
export type Letter = z.infer<typeof Letter>

export const ROLES = ['owner', 'admin', 'member'] as const
export const Role = z.enum(ROLES)
export type Role = z.infer<typeof Role>

export const Member = z.object({ email: Email, role: Role, devices: z.array(DeviceKey).check(z.maxLength(20)) })
export type Member = z.infer<typeof Member>

export const PendingInvite = z.object({ email: Email, role: z.enum(['admin', 'member']), key: DeviceKey })
export type PendingInvite = z.infer<typeof PendingInvite>

export const MemberListBody = z.object({
  workspace: Id,
  version: z.number().check(z.int(), z.minimum(1)),
  previous: z.nullable(Base64),
  members: z.array(Member).check(z.minLength(1), z.maxLength(500)),
  invites: z.array(PendingInvite).check(z.maxLength(100)),
  removed: z.array(DeviceKey).check(z.maxLength(5000)),
})
export type MemberListBody = z.infer<typeof MemberListBody>

export const MemberList = z.object({ object: z.literal('member_list'), ...Signed.shape })
export type MemberList = z.infer<typeof MemberList>

export const Invite = z.object({
  id: Id,
  object: z.literal('invite'),
  workspace: Id,
  email: Email,
  role: z.enum(['admin', 'member']),
  body: Locked,
  expiresAt: Timestamp,
})
export type Invite = z.infer<typeof Invite>

export const KEY_BOX_KINDS = ['passkey', 'kit'] as const
export const KeyBox = z.object({ object: z.literal('key_box'), kind: z.enum(KEY_BOX_KINDS), body: Locked })
export type KeyBox = z.infer<typeof KeyBox>

export const Here = z.object({ object: z.literal('here'), from: DeviceKey, body: Locked })
export type Here = z.infer<typeof Here>
