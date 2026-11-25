import type { FastifyRequest } from 'fastify'
import { HttpError } from './http-error.ts'

const WINDOW_MS = 15 * 60_000
const hits = new Map<string, { n: number; until: number }>()

export function requireUnder({ keys, max }: { keys: string[]; max: number }): void {
  const now = Date.now()
  const over = keys.map((key) => hits.get(key)).find((hit) => hit && hit.until > now && hit.n >= max)
  if (over) throw new HttpError(429, `Too many tries. Wait ${Math.ceil((over.until - now) / 60_000)} minutes and try again.`)
}

export function rateLimit({ keys, max }: { keys: string[]; max: number }): void {
  const now = Date.now()
  for (const key of keys) {
    const hit = hits.get(key)
    const next = hit && hit.until > now ? { n: hit.n + 1, until: hit.until } : { n: 1, until: now + WINDOW_MS }
    hits.set(key, next)
    if (next.n > max) throw new HttpError(429, `Too many tries. Wait ${Math.ceil((next.until - now) / 60_000)} minutes and try again.`)
  }
  if (hits.size > 50_000) for (const [key, hit] of hits) if (hit.until <= now) hits.delete(key)
}

export const clientOf = (req: FastifyRequest): string => req.raw.socket.remoteAddress ?? 'unknown'
