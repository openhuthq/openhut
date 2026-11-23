import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../../api.ts'
import { AskAdmin, DeviceKey, Letter, Locked, MemberList, NewInvite } from '../cloud.ts'
import { Email, NamedKeyBox, WorkspaceId } from './identity.ts'
import { LETTER_PURPOSES } from '../../vault/vault.ts'

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
