import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { check, concat, field, fromBase64, isLocked, LETTER_PURPOSES, sign, toBase64, type Bytes, type Identity, type Pairing } from '../vault/vault.ts'

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

export const Member = z.object({ email: Email, role: Role, devices: z.array(DeviceKey).check(z.maxLength(20)), kit: z.optional(DeviceKey) })
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

export const NewInvite = z.object({ id: Id, email: Email, role: InviteRole, key: DeviceKey, body: Locked })
export type NewInvite = z.infer<typeof NewInvite>

export const OpenedInvite = z.object({ ...Invite.shape, memberLists: z.array(MemberList).check(z.maxLength(200)), hasMore: z.optional(z.boolean()) })
export type OpenedInvite = z.infer<typeof OpenedInvite>

export const WorkspaceName = z.string().check(z.trim(), z.minLength(1, 'Give the workspace a name.'), z.maxLength(60, 'Keep the name under 60 characters.'))
export const RenameWorkspace = z.object({ name: WorkspaceName })
export type RenameWorkspace = z.infer<typeof RenameWorkspace>
export const LockedName = z.object({ name: Locked.check(z.maxLength(1024)) })

export const CloudWorkspace = z.object({ id: Id, object: z.literal('workspace'), name: z.nullable(z.string()) })
export type CloudWorkspace = z.infer<typeof CloudWorkspace>

export const KEY_BOX_KINDS = ['passkey', 'kit', 'kit-confirmed'] as const
export const KeyBox = z.object({ object: z.literal('key_box'), kind: z.enum(KEY_BOX_KINDS), body: Locked, by: z.optional(DeviceKey), signature: z.optional(Signature), savedAt: z.optional(Timestamp) })
export type KeyBox = z.infer<typeof KeyBox>

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

export const PairingQr = z.object({
  openhut: z.literal('pair'),
  secret: z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{20}$/)),
  fingerprint: canonical({ length: 43, message: 'Send the fingerprint as 32 bytes of base64url.' }),
  hint: z.string().check(z.maxLength(320)),
})

export function qrPayload(pairing: Pairing): string {
  return JSON.stringify({ openhut: 'pair', secret: pairing.secret, fingerprint: pairing.fingerprint, hint: pairing.hint })
}

export function fromQr(payload: string): Pairing | null {
  const parsed = PairingQr.safeParse(parseJson(payload))
  return parsed.success ? { secret: parsed.data.secret, fingerprint: parsed.data.fingerprint, hint: parsed.data.hint } : null
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const PROOFS = ['session', 'refresh', 'delete', 'key-box', 'device', 'words'] as const
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

export const CreateCloudSession = z.discriminatedUnion('grantType', [
  z.object({
    grantType: z.literal('authorization_code'), authorization: z.string().check(z.maxLength(2000)), code: z.string().check(z.maxLength(2000)),
    codeVerifier: z.string().check(z.maxLength(200)), deviceKey: DeviceKey, signature: Signature,
  }),
  z.object({ grantType: z.literal('refresh'), session: z.string().check(z.maxLength(2000)), signedAt: z.number().check(z.int()), signature: Signature }),
])
export type CreateCloudSession = z.infer<typeof CreateCloudSession>

export const CloudSession = z.object({ object: z.literal('cloud_session'), token: z.string(), sub: z.string(), email: Email, expiresAt: Timestamp })
export type CloudSession = z.infer<typeof CloudSession>

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

export const WordsNonce = z.object({ nonce: Base64, by: DeviceKey, signature: Signature })
export type WordsNonce = z.infer<typeof WordsNonce>

export const AskAdmin = z.object({ name: z.string().check(z.maxLength(64)), os: z.string().check(z.maxLength(32)) })
export type AskAdmin = z.infer<typeof AskAdmin>

export const DeviceRequest = z.object({ device: DeviceKey, email: Email, at: Timestamp, name: z._default(z.nullable(z.string()), null), os: z._default(z.nullable(z.string()), null), nonce: z._default(z.nullable(WordsNonce), null) })
export type DeviceRequest = z.infer<typeof DeviceRequest>

export const DeleteNotice = z.object({ by: DeviceKey, signedAt: z.number(), signature: Signature })
export type DeleteNotice = z.infer<typeof DeleteNotice>

export const CloudWorkspaceView = z.object({
  id: Id,
  name: z.string(),
  home: z.boolean(),
  own: z._default(z.boolean(), false),
  role: Role,
  waiting: z.boolean(),
  members: z.array(Member),
  invites: z.array(z.object({ email: Email, role: InviteRole, link: z.nullable(z.string()) })),
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
  kit: z.nullable(z.object({ savedAt: Timestamp, differs: z.boolean() })),
  kitInCloud: z.boolean(),
  backup: Backup,
  signInError: z.nullable(z.string()),
  keptAccount: z.nullable(Email),
  devices: z.array(z.object({ key: DeviceKey, here: z.boolean(), addedAt: z.nullable(Timestamp), name: z.nullable(z.string()), kind: z.enum(['mac', 'server']) })),
  passkey: z.boolean(),
  youngUntil: z._default(z.nullable(Timestamp), null),
  needsSignIn: z.boolean(),
  workspaces: z._default(z.array(CloudWorkspaceView), []),
  asking: z._default(z.nullable(z.object({ rooms: z.array(z.object({ admins: z.array(Email), words: z.nullable(z.array(z.string())) })), denied: z.boolean() })), null),
  canAsk: z._default(z.boolean(), false),
  rotate: z._default(z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })), []),
  gone: z._default(z.array(z.object({ name: z.string(), why: z.enum(['removed', 'deleted']) })), []),
})
export type Cloud = z.infer<typeof Cloud>

export const CloudAuthorization = z.object({ object: z.literal('cloud_authorization'), authorizationUrl: z.string() })
export type CloudAuthorization = z.infer<typeof CloudAuthorization>

export const RecoveryKit = z.object({ object: z.literal('recovery_kit'), words: z.array(z.string()), ask: z.array(z.number().check(z.int())) })
export type RecoveryKit = z.infer<typeof RecoveryKit>

const Prf = canonical({ length: 43, message: 'Send the passkey’s PRF output as 32 bytes of base64url.' })
export const UnlockCloud = z.union([z.object({ words: z.array(z.string().check(z.maxLength(40))).check(z.length(12)) }), z.object({ prf: Prf })])
export type UnlockCloud = z.infer<typeof UnlockCloud>

export const AddPasskey = z.object({ prf: Prf })
export type AddPasskey = z.infer<typeof AddPasskey>

export const CloudPairing = z.object({ object: z.literal('pairing'), qr: z.string(), code: z.string(), expiresAt: Timestamp })
export type CloudPairing = z.infer<typeof CloudPairing>

export const AllowDevice = z.object({ code: z.string().check(z.maxLength(1000)) })
export type AllowDevice = z.infer<typeof AllowDevice>

export const AllowedDevice = z.object({ object: z.literal('pairing_allowed'), devices: z.array(DeviceKey) })
export type AllowedDevice = z.infer<typeof AllowedDevice>

export const CreateCloudInvite = z.object({ workspace: Id, email: z.pipe(z.string().check(z.trim(), z.toLowerCase()), Email), role: InviteRole })
export type CreateCloudInvite = z.infer<typeof CreateCloudInvite>

export const CloudInvite = z.object({ object: z.literal('cloud_invite'), id: z.string(), workspace: Id, email: Email, role: InviteRole, link: z.string(), expiresAt: Timestamp })
export type CloudInvite = z.infer<typeof CloudInvite>

export const InviteLink = z.object({ link: z.string().check(z.maxLength(2000)) })
export type InviteLink = z.infer<typeof InviteLink>

export const CloudInvitePreview = z.object({ object: z.literal('cloud_invite_preview'), workspace: Id, name: z.string(), from: Email, email: Email, role: InviteRole })
export type CloudInvitePreview = z.infer<typeof CloudInvitePreview>

export const InviteLetter = z.object({ workspace: Id, name: z.string().check(z.maxLength(200)), from: Email, email: Email, role: InviteRole, anchor: Base64, expiresAt: Timestamp })
export type InviteLetter = z.infer<typeof InviteLetter>

export const ChangeRole = z.object({ role: Role })
export type ChangeRole = z.infer<typeof ChangeRole>

export const CreateWorkspace = z.object({ name: RenameWorkspace.shape.name })
export type CreateWorkspace = z.infer<typeof CreateWorkspace>

export const DeleteWorkspace = z.object({ name: z.string().check(z.maxLength(200)) })
export type DeleteWorkspace = z.infer<typeof DeleteWorkspace>

export const ApproveDevice = z.object({ words: z.array(z.string().check(z.maxLength(20))).check(z.length(4)) })
export type ApproveDevice = z.infer<typeof ApproveDevice>
