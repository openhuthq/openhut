import * as z from 'zod/mini'

export const ErrorType = z.enum(['invalid_request_error', 'api_error'])
export type ErrorType = z.infer<typeof ErrorType>

export const ApiError = z.object({
  error: z.object({
    type: ErrorType,
    message: z.string(),
    code: z.optional(z.string()),
    param: z.optional(z.string()),
  }),
})
export type ApiError = z.infer<typeof ApiError>

export const Timestamp = z.iso.datetime()

export const ListQuery = z.object({
  limit: z.optional(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100))),
  startingAfter: z.optional(z.string()),
})
export type ListQuery = z.infer<typeof ListQuery>

export function List<T extends z.ZodMiniType>(item: T) {
  return z.object({ object: z.literal('list'), url: z.string(), hasMore: z.boolean(), data: z.array(item) })
}
export type List<T> = { object: 'list'; url: string; hasMore: boolean; data: T[] }

export function Deleted<O extends string>(object: O) {
  return z.object({ id: z.string(), object: z.literal(object), deleted: z.literal(true) })
}
export type Deleted<O extends string> = { id: string; object: O; deleted: true }

export const atLeastOneField = z.refine((body: unknown) => typeof body === 'object' && body !== null && Object.keys(body).length > 0, 'Send at least one field to change.')
