import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { check, concat, field, fromBase64, isLocked, LETTER_PURPOSES, sign, toBase64, type Bytes, type Identity } from '../vault/public.ts'

const base64 = /^[A-Za-z0-9_-]*$/

function bytesOf(value: string): Uint8Array | null {
  if (!base64.test(value) || value.length % 4 === 1) return null
  const bytes = fromBase64(value)
  return toBase64(bytes) === value ? bytes : null
}

function canonical({ length, message }: { length: number; message: string }) {
  return z.string().check(z.length(length), z.refine((value) => bytesOf(value) !== null, message))
}

export const Base64 = z.string().check(z.maxLength(1_000_000), z.refine((value) => bytesOf(value) !== null, 'Send bytes as unpadded base64url.'))
export const Locked = z.string().check(
  z.maxLength(1_000_000),
  z.refine((value) => {
    const bytes = bytesOf(value)
    return bytes !== null && isLocked(bytes)
  }, 'Send the body locked by the vault, as base64url.'),
)
export const DeviceKey = canonical({ length: 86, message: 'Send a device key as 64 bytes of base64url.' })
export const Signature = canonical({ length: 86, message: 'Send an Ed25519 signature as 64 bytes of base64url.' })
const Version = z.number().check(z.int(), z.minimum(1), z.maximum(0xffffffff))
const Id = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/, 'Send an id of 8 to 64 base64url characters.'))
const Email = z.string().check(z.maxLength(320), z.regex(/^[^\sA-Z@]+@[^\sA-Z@]+$/, 'Send the email in lowercase.'))

export const RECORD_KINDS = ['agent', 'instructions', 'memory', 'skill', 'routine', 'connection', 'channel', 'thread', 'message', 'setting', 'head', 'file'] as const
export const RecordKind = z.enum(RECORD_KINDS)
export type RecordKind = z.infer<typeof RecordKind>

export const Record = z.object({
  id: Id,
  object: z.literal('record'),
  ver: Version,
  seq: z.number().check(z.int(), z.minimum(0)),
  deleted: z.boolean(),
  body: Locked,
})
export type Record = z.infer<typeof Record>

export const Signed = z.object({ bytes: Base64, by: DeviceKey, signature: Signature })
export type Signed = z.infer<typeof Signed>

export function recordBind({ workspace, id, kind }: { workspace: string; id: string; kind: RecordKind }): string {
  return `workspace/${workspace}/record/${id}/${kind}`
}

export async function signRecord({ signer, bind, bytes }: { signer: Identity; bind: string; bytes: Bytes }): Promise<Signed> {
  const signature = await sign({ secret: signer.secret, bytes: recordMessage({ bind, bytes }) })
  return { bytes: toBase64(bytes), by: toBase64(signer.publicKey), signature: toBase64(signature) }
}

export async function checkRecord({ signed, bind }: { signed: Signed; bind: string }): Promise<Bytes | null> {
  if (!Signed.safeParse(signed).success) return null
  const bytes = fromBase64(signed.bytes)
  const valid = await check({ publicKey: fromBase64(signed.by), bytes: recordMessage({ bind, bytes }), signature: fromBase64(signed.signature) })
  return valid ? bytes : null
}

function recordMessage({ bind, bytes }: { bind: string; bytes: Bytes }): Bytes {
  return concat([new TextEncoder().encode('openhut/record\0'), field(bind), bytes])
}

export const Letter = z.object({
  id: Id,
  object: z.literal('letter'),
  to: DeviceKey,
  from: DeviceKey,
  workspace: Id,
  purpose: z.enum(LETTER_PURPOSES),
  body: Locked,
})
export type Letter = z.infer<typeof Letter>

export const ROLES = ['owner', 'admin', 'member'] as const
export const Role = z.enum(ROLES)
export type Role = z.infer<typeof Role>

export const Member = z.object({ email: Email, role: Role, devices: z.array(DeviceKey).check(z.maxLength(20)), kit: z.optional(DeviceKey), viewers: z.optional(z.array(DeviceKey).check(z.maxLength(20))) })
export type Member = z.infer<typeof Member>

export const PendingInvite = z.object({ email: Email, role: z.enum(['admin', 'member']), key: DeviceKey })
export type PendingInvite = z.infer<typeof PendingInvite>

export const MemberListBody = z.object({
  workspace: Id,
  version: Version,
  previous: z.nullable(Base64),
  members: z.array(Member).check(z.minLength(1), z.maxLength(500)),
  invites: z.array(PendingInvite).check(z.maxLength(100)),
  removed: z.array(DeviceKey).check(z.maxLength(5000)),
  keyVersion: z.optional(Version),
  runtimes: z.optional(z.array(DeviceKey).check(z.maxLength(100))),
  at: z.optional(z.number().check(z.int(), z.minimum(0))),
  added: z.optional(z.record(DeviceKey, z.number().check(z.int(), z.minimum(0)))),
  names: z.optional(z.record(DeviceKey, z.string().check(z.maxLength(64)))),
  managed: z.optional(DeviceKey),
})
export type MemberListBody = z.infer<typeof MemberListBody>

export const MemberList = z.object({ object: z.literal('member_list'), ...Signed.shape })
export type MemberList = z.infer<typeof MemberList>

export const InviteRole = z.enum(['admin', 'member'])
export const Invite = z.object({
  id: Id,
  object: z.literal('invite'),
  workspace: Id,
  email: Email,
  role: InviteRole,
  key: DeviceKey,
  from: DeviceKey,
  body: Locked,
  expiresAt: Timestamp,
})
export type Invite = z.infer<typeof Invite>

export const NewInvite = z.object({ id: Id, email: Email, role: InviteRole, key: DeviceKey, body: Locked, link: z.string().check(z.maxLength(2000)) })
export type NewInvite = z.infer<typeof NewInvite>

export const OpenedInvite = z.object({ ...Invite.shape, memberLists: z.array(MemberList).check(z.maxLength(200)), hasMore: z.optional(z.boolean()) })
export type OpenedInvite = z.infer<typeof OpenedInvite>

export const WorkspaceName = z.string().check(z.trim(), z.minLength(1, 'Give the team a name.'), z.maxLength(60, 'Keep the name under 60 characters.'))
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/

export function siteHost(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > 200) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return !url.username && !url.password && !url.port && url.hostname.length <= 253 && HOST.test(url.hostname) ? url.hostname : null
  } catch {
    return null
  }
}

export const Website = z.string().check(z.refine((value) => siteHost(value) !== null, 'Enter a website like example.com.'))
export const UpdateWorkspace = z.object({ name: z.optional(WorkspaceName), website: z.optional(z.nullable(Website)) })
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>
export const LockedWorkspace = z.object({ name: z.optional(Locked.check(z.maxLength(1024))), site: z.optional(Locked.check(z.maxLength(1024))) })

export const CloudWorkspace = z.object({ id: Id, object: z.literal('workspace'), name: z.nullable(z.string()), site: z.optional(z.nullable(z.string())) })
export type CloudWorkspace = z.infer<typeof CloudWorkspace>

export const Here = z.object({ object: z.literal('here'), from: DeviceKey, body: Locked })
export type Here = z.infer<typeof Here>

export const HERE_FIELDS = ['name', 'instructions', 'face'] as const
export const HereField = z.enum(HERE_FIELDS)
export type HereField = z.infer<typeof HereField>
export const SetHere = z.object({ agent: z.nullable(z.string().check(z.maxLength(40))), field: z.nullable(HereField), typing: z.boolean() })
export type SetHere = z.infer<typeof SetHere>
export const Presence = z.object({
  object: z.literal('presence'),
  since: z.nullable(z.number()),
  people: z.array(z.object({ email: z.string(), agentId: z.string(), field: z.nullable(HereField), typing: z.boolean(), since: z.number() })),
  mismatch: z.array(z.object({ workspace: z.string(), email: z.string() })),
})
export type Presence = z.infer<typeof Presence>

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const PROOFS = ['session', 'refresh', 'delete', 'key-box', 'device', 'agent-owner'] as const
export type Proof = (typeof PROOFS)[number]

export function proofBytes({ proof, parts }: { proof: Proof; parts: string[] }): Bytes {
  return concat([new TextEncoder().encode(`openhut/${proof}\0`), ...parts.map(field)])
}

export async function signProof({ signer, proof, parts }: { signer: Identity; proof: Proof; parts: string[] }): Promise<string> {
  return toBase64(await sign({ secret: signer.secret, bytes: proofBytes({ proof, parts }) }))
}

export async function checkProof({ device, proof, parts, signature }: { device: string; proof: Proof; parts: string[]; signature: string }): Promise<boolean> {
  if (!DeviceKey.safeParse(device).success || !Signature.safeParse(signature).success) return false
  return check({ publicKey: fromBase64(device), bytes: proofBytes({ proof, parts }), signature: fromBase64(signature) })
}

export const CloudSession = z.object({ object: z.literal('cloud_session'), token: z.string(), refresh: z.optional(z.string()), sub: z.string(), email: Email, expiresAt: Timestamp })
export type CloudSession = z.infer<typeof CloudSession>

export const CloudSignIn = z.object({ url: z.string() })
export type CloudSignIn = z.infer<typeof CloudSignIn>

export const SignedRequest = z.object({ signedAt: z.number().check(z.int()), signature: Signature })
export type SignedRequest = z.infer<typeof SignedRequest>

export const DeviceSession = z.object({ device: DeviceKey, signedAt: z.number().check(z.int()), signature: Signature })
export type DeviceSession = z.infer<typeof DeviceSession>

export const AddRuntime = z.object({ device: DeviceKey })
export type AddRuntime = z.infer<typeof AddRuntime>

export const RuntimeInvite = z.object({ object: z.literal('runtime_invite'), workspace: Id, email: Email, from: DeviceKey })
export type RuntimeInvite = z.infer<typeof RuntimeInvite>

export const CLOUD_STATUSES = ['off', 'on', 'offline', 'locked'] as const
export const Backup = z.object({
  state: z.enum(['idle', 'backing_up', 'restoring', 'failed']),
  done: z.number(),
  total: z.number(),
  current: z.nullable(z.string()),
  at: z.nullable(Timestamp),
  agent: z.nullable(z.string()),
  problem: z.nullable(z.string()),
})
export type Backup = z.infer<typeof Backup>

export const AskAdmin = z.object({ name: z.string().check(z.maxLength(64)), os: z.string().check(z.maxLength(32)) })
export type AskAdmin = z.infer<typeof AskAdmin>

const CREATURES = ['Tilly', 'Moss', 'Bea', 'Duke', 'Sunny', 'Nibs', 'Wally', 'Sprig', 'Pip', 'Fig', 'Ziggy', 'Rosie']
export function creatureName(index: number): string {
  return CREATURES[index % CREATURES.length]
}
export const KNOCK_MS = 15 * 60_000
export const RemoveDeviceQuery = z.object({ lost: z.optional(z.enum(['true'])) })
export type RemoveDeviceQuery = z.infer<typeof RemoveDeviceQuery>
export const DeviceRequest = z.object({ device: DeviceKey, email: Email, at: Timestamp, name: z._default(z.nullable(z.string()), null), os: z._default(z.nullable(z.string()), null), server: z._default(z.boolean(), false), location: z._default(z.nullable(z.object({ city: z.nullable(z.string()), country: z.string(), countryCode: z.string() })), null), newCountry: z._default(z.boolean(), false) })
export type DeviceRequest = z.infer<typeof DeviceRequest>

export const DeleteNotice = z.object({ by: DeviceKey, signedAt: z.number(), signature: Signature })
export type DeleteNotice = z.infer<typeof DeleteNotice>

export const CloudWorkspaceView = z.object({
  id: Id,
  name: z.string(),
  website: z._default(z.nullable(z.string()), null),
  home: z.boolean(),
  own: z._default(z.boolean(), false),
  role: Role,
  waiting: z.boolean(),
  members: z.array(Member),
  invites: z.array(z.object({ email: Email, role: InviteRole, link: z.nullable(z.string()), until: z._default(z.nullable(Timestamp), null) })),
  requests: z._default(z.array(DeviceRequest), []),
  names: z._default(z.record(z.string(), z.string()), {}),
})
export type CloudWorkspaceView = z.infer<typeof CloudWorkspaceView>

export const Cloud = z.object({
  object: z.literal('cloud'),
  status: z.enum(CLOUD_STATUSES),
  email: z.nullable(Email),
  device: z.nullable(DeviceKey),
  workspace: z.nullable(z.object({ id: Id, version: Version, members: z.array(Member) })),
  keyStore: z.enum(['keychain', 'file']),
  backup: Backup,
  signInError: z.nullable(z.string()),
  devices: z.array(z.object({ key: DeviceKey, here: z.boolean(), addedAt: z.nullable(Timestamp), name: z.nullable(z.string()), kind: z.enum(['mac', 'server']), online: z._default(z.boolean(), false), os: z._default(z.nullable(z.string()), null), heard: z._default(z.boolean(), true), joined: z._default(z.nullable(z.union([z.object({ how: z.literal('recovery') }), z.object({ how: z.literal('approved'), by: z.nullable(z.string()) })])), null) })),
  needsSignIn: z.boolean(),
  workspaces: z._default(z.array(CloudWorkspaceView), []),
  asking: z._default(z.nullable(z.object({ rooms: z.array(z.object({ admins: z.array(Email), own: z._default(z.boolean(), false) })), denied: z.boolean(), error: z._default(z.nullable(z.string()), null), name: z._default(z.nullable(z.string()), null) })), null),
  canAsk: z._default(z.boolean(), false),
  rotate: z._default(z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })), []),
  gone: z._default(z.array(z.object({ name: z.string(), why: z.enum(['removed', 'deleted']), owner: z._default(z.nullable(z.string()), null) })), []),
})
export type Cloud = z.infer<typeof Cloud>

export const CloudAuthorization = z.object({ object: z.literal('cloud_authorization'), authorizationUrl: z.string() })
export const StartCloudSignIn = z.nullish(z.object({ loginHint: z.optional(Email) }))
export type StartCloudSignIn = z.infer<typeof StartCloudSignIn>
export const PasteSignInCode = z.object({ code: z.string().check(z.maxLength(200)) })
export type PasteSignInCode = z.infer<typeof PasteSignInCode>
export type CloudAuthorization = z.infer<typeof CloudAuthorization>

export const CreateCloudInvite = z.object({ workspace: Id, email: z.pipe(z.string().check(z.trim(), z.toLowerCase()), Email), role: InviteRole })
export type CreateCloudInvite = z.infer<typeof CreateCloudInvite>

export const CloudInvite = z.object({ object: z.literal('cloud_invite'), id: z.string(), workspace: Id, email: Email, role: InviteRole, link: z.string(), expiresAt: Timestamp })
export type CloudInvite = z.infer<typeof CloudInvite>

export const InviteLetter = z.object({ workspace: Id, name: z.string().check(z.maxLength(200)), from: Email, email: Email, role: InviteRole, anchor: Base64, expiresAt: Timestamp })
export type InviteLetter = z.infer<typeof InviteLetter>

export const ChangeRole = z.object({ role: Role })
export type ChangeRole = z.infer<typeof ChangeRole>

export const CreateWorkspace = z.object({ name: WorkspaceName })
export type CreateWorkspace = z.infer<typeof CreateWorkspace>

export const DeleteWorkspace = z.object({ name: z.string().check(z.maxLength(200)) })
export type DeleteWorkspace = z.infer<typeof DeleteWorkspace>
