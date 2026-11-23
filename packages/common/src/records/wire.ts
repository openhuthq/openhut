import * as z from 'zod/mini'
import { ApiError, List, Timestamp } from '../api.ts'
import { Base64, DeviceKey, Signature } from '../cloud/cloud.ts'

export const COLLECTIONS = ['workspace', 'agent', 'control', 'message', 'memory', 'connection', 'skill', 'routine', 'channel', 'file'] as const
export const Collection = z.enum(COLLECTIONS)
export type Collection = z.infer<typeof Collection>
export const PER_AGENT: Collection[] = ['control', 'message', 'memory', 'skill', 'routine', 'channel', 'file']

const Id = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/, 'Send an id of 8 to 64 base64url characters.'))
const Parent = z.nullable(z.string().check(z.minLength(1), z.maxLength(320)))
const Ver = z.number().check(z.int(), z.minimum(1), z.maximum(0xffffffff))

export const PutSealed = z.object({ workspace: Id, parent: Parent, ver: Ver, by: DeviceKey, sig: Signature, body: Base64, deleted: z.boolean() })
export type PutSealed = z.infer<typeof PutSealed>

export const SealedRow = z.object({ id: Id, object: Collection, ...PutSealed.shape, updatedAt: z.optional(Timestamp) })
export type SealedRow = z.infer<typeof SealedRow>

export const SealedList = List(SealedRow)
export type SealedList = z.infer<typeof SealedList>

export const ListSealedQuery = z.object({
  workspace: Id,
  parent: z.optional(z.string().check(z.minLength(1), z.maxLength(320))),
  startingAfter: z.optional(Id),
  limit: z.optional(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100))),
})
export type ListSealedQuery = z.infer<typeof ListSealedQuery>

export const SealedConflict = z.object({ ...ApiError.shape, current: z.optional(SealedRow) })
export type SealedConflict = z.infer<typeof SealedConflict>
