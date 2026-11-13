import type { FastifyRequest } from 'fastify'
import type { List } from '@jakebox/common/api.ts'

export function listOf<T>({ req, data, hasMore = false }: { req: FastifyRequest; data: T[]; hasMore?: boolean }): List<T> {
  return { object: 'list', url: req.url.split('?')[0], hasMore, data }
}
