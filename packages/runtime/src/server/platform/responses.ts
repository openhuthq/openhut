import type { FastifyRequest } from 'fastify'
import type { Deleted, List } from '@openhut/common/api.ts'
import { LEGACY_MODELS } from '@openhut/common/models/provider.ts'

export function listOf<T>({ req, data, hasMore = false }: { req: FastifyRequest; data: T[]; hasMore?: boolean }): List<T> {
  return { object: 'list', url: req.url.split('?')[0], hasMore, data }
}

export function deleted<O extends string>({ id, object }: { id: string; object: O }): Deleted<O> {
  return { id, object, deleted: true }
}

const FIRST_APP_WITH_MODEL_KEYS = [0, 1, 2]
const LEGACY_IDS: Record<string, string> = Object.fromEntries(Object.entries(LEGACY_MODELS).map(([id, key]) => [key, id]))

export function forOlderApps({ req, payload }: { req: FastifyRequest; payload: unknown }): unknown {
  const version = req.headers['openhut-app-version']
  const parts = typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : undefined
  const at = parts?.findIndex((part, index) => part !== FIRST_APP_WITH_MODEL_KEYS[index]) ?? -1
  if (!parts || at < 0 || parts[at] > FIRST_APP_WITH_MODEL_KEYS[at]) return payload
  return withLegacyModels(payload)
}

function withLegacyModels(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.object === 'agent' && typeof value.model === 'string') return { ...value, model: LEGACY_IDS[value.model] ?? 'sonnet' }
  if (value.object === 'list' && Array.isArray(value.data)) return { ...value, data: value.data.map(withLegacyModels) }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
