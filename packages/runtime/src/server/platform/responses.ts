import type { FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import type { Deleted, List } from '@openhut/common/api.ts'

export function listOf<T>({ req, data, hasMore = false }: { req: FastifyRequest; data: T[]; hasMore?: boolean }): List<T> {
  return { object: 'list', url: req.url.split('?')[0], hasMore, data }
}

export function deleted<O extends string>({ id, object }: { id: string; object: O }): Deleted<O> {
  return { id, object, deleted: true }
}

export const IdParams = z.object({ id: z.string() })
