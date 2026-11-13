import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const EXPECTED = createHash('sha256').update(config.publishKey).digest()

export async function requirePublishKey(req: FastifyRequest): Promise<void> {
  if (!config.publishKey) throw new HttpError(401, 'This console has no publish key. Set CONSOLE_PUBLISH_KEY and restart it.')
  const given = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
  if (!timingSafeEqual(createHash('sha256').update(given).digest(), EXPECTED)) throw new HttpError(401, 'Send the publish key as Authorization: Bearer <key>.')
}
