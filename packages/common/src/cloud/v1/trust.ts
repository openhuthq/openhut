import * as z from 'zod/mini'
import { Timestamp } from '../../api.ts'
import { AskAdmin, DeviceKey, Letter, Locked, MemberList, NewInvite } from '../cloud.ts'
import { Email, NamedKeyBox, WorkspaceId } from './identity.ts'
import { LETTER_PURPOSES } from '../../vault/public.ts'

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

export const CreateInvite = z.object({ workspace: WorkspaceId, ...NewInvite.shape })
export type CreateInvite = z.infer<typeof CreateInvite>

const Nonce = z.string().check(z.regex(/^[\w-]{43}$/))
export const CreateJoinRequest = z.object({ workspace: WorkspaceId, ...AskAdmin.shape, server: z._default(z.boolean(), false), commit: z.optional(Nonce) })
export type CreateJoinRequest = z.infer<typeof CreateJoinRequest>
export const JoinRequest = z.object({
  id: DeviceKey,
  object: z.literal('join_request'),
  workspace: WorkspaceId,
  email: Email,
  asked: z.boolean(),
  name: z.nullable(z.string()),
  os: z.nullable(z.string()),
  server: z.boolean(),
  at: Timestamp,
  commit: z._default(z.nullable(z.string()), null),
  nonce: z._default(z.nullable(z.string()), null),
  reviewed: z._default(z.boolean(), false),
  missed: z._default(z.boolean(), false),
  location: z._default(z.nullable(z.object({ city: z.nullable(z.string()), country: z.string(), countryCode: z.string() })), null),
  newCountry: z._default(z.boolean(), false),
})
export type JoinRequest = z.infer<typeof JoinRequest>
export const RevealJoinRequest = z.object({ workspace: WorkspaceId, nonce: Nonce })
export type RevealJoinRequest = z.infer<typeof RevealJoinRequest>
export const DenyJoinRequest = z.object({ workspace: WorkspaceId, why: z.optional(z.enum(['mismatch', 'not-me'])) })
export type DenyJoinRequest = z.infer<typeof DenyJoinRequest>
