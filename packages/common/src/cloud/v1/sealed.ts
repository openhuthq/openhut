import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../../api.ts'
import { WorkspaceId } from './identity.ts'

const Id = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/, 'Send an id of 8 to 64 base64url characters.'))
export const BlobId = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/, 'Send a blob id: the SHA-256 of the locked bytes, as base64url.'))
export const MAX_BLOB = (32 << 20) + 64

export const ListRows = z.object({
  workspace: WorkspaceId,
  parent: z.optional(z.string().check(z.minLength(1), z.maxLength(320))),
  startingAfter: z.optional(Id),
  limit: ListQuery.shape.limit,
})
export type ListRows = z.infer<typeof ListRows>

export const CreateFileUpload = z.object({ workspace: WorkspaceId, blob: BlobId, size: z.number().check(z.int(), z.minimum(1), z.maximum(MAX_BLOB)) })
export type CreateFileUpload = z.infer<typeof CreateFileUpload>
export const FileUpload = z.object({ id: BlobId, object: z.literal('file_upload'), method: z.literal('PUT'), url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: Timestamp })
export type FileUpload = z.infer<typeof FileUpload>
export const FileDownload = z.object({ id: BlobId, object: z.literal('file_download'), url: z.string(), expiresAt: Timestamp })
export type FileDownload = z.infer<typeof FileDownload>
