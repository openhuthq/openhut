import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../../api.ts'
import { AskAdmin, Base64, DeviceKey, Letter, Locked, MemberList, NewInvite, Signature } from '../cloud.ts'
import { DeviceKind, Email, NamedKeyBox, WorkspaceId } from './identity.ts'
import { concat, field, sha256, LETTER_PURPOSES, type Bytes } from '../../vault/vault.ts'

export const WorkspaceQuery = z.object({ workspace: WorkspaceId })
export type WorkspaceQuery = z.infer<typeof WorkspaceQuery>

export const NewLetter = z.object({ to: DeviceKey, purpose: z.enum(LETTER_PURPOSES), body: Locked.check(z.maxLength(16_384)) })
export type NewLetter = z.infer<typeof NewLetter>
export const CreateLetter = z.object({ workspace: WorkspaceId, ...NewLetter.shape })
export type CreateLetter = z.infer<typeof CreateLetter>
export { Letter }

export const PostMemberList = z.object({
  list: MemberList,
  letters: z._default(z.array(NewLetter).check(z.maxLength(500)), []),
  boxes: z._default(z.array(NamedKeyBox).check(z.maxLength(10)), []),
})
export type PostMemberList = z.infer<typeof PostMemberList>

export const ListMemberLists = z.object({ workspace: WorkspaceId, startingAfter: z.optional(z.coerce.number().check(z.int(), z.minimum(0))), limit: ListQuery.shape.limit })
export type ListMemberLists = z.infer<typeof ListMemberLists>

export const Workspace = z.object({
  id: WorkspaceId,
  object: z.literal('workspace'),
  version: z.number(),
  ver: z.number(),
  by: z.nullable(DeviceKey),
  sig: z.nullable(Signature),
  body: z.string(),
  updatedAt: z.nullable(Timestamp),
})
export type Workspace = z.infer<typeof Workspace>
export const PutWorkspace = z.object({ ver: z.number().check(z.int(), z.minimum(1), z.maximum(0xffffffff)), by: DeviceKey, sig: Signature, body: Base64.check(z.minLength(1), z.maxLength(65_536)) })
export type PutWorkspace = z.infer<typeof PutWorkspace>

export async function workspaceBytes({ workspace, ver, body }: { workspace: string; ver: number; body: Bytes }): Promise<Bytes> {
  return concat([new TextEncoder().encode('openhut/sealed\0'), field(JSON.stringify(['workspace', workspace, workspace, ver, null])), await sha256(body)])
}

export const Device = z.object({
  id: DeviceKey,
  object: z.literal('device'),
  workspace: WorkspaceId,
  email: z.nullable(Email),
  kind: z.nullable(DeviceKind),
  name: z.nullable(z.string()),
  addedAt: z.nullable(Timestamp),
  removed: z.boolean(),
})
export type Device = z.infer<typeof Device>

export const CreateInvite = z.object({ workspace: WorkspaceId, ...NewInvite.shape })
export type CreateInvite = z.infer<typeof CreateInvite>

export const CreateJoinRequest = z.object({ workspace: WorkspaceId, ...AskAdmin.shape })
export type CreateJoinRequest = z.infer<typeof CreateJoinRequest>
export const JoinRequest = z.object({
  id: DeviceKey,
  object: z.literal('join_request'),
  workspace: WorkspaceId,
  email: Email,
  asked: z.boolean(),
  name: z.nullable(z.string()),
  os: z.nullable(z.string()),
  at: Timestamp,
})
export type JoinRequest = z.infer<typeof JoinRequest>
