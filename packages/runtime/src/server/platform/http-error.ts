import type { FastifyError, FastifyInstance } from 'fastify'
import type { ApiError } from '@openhut/common/api.ts'
import { log } from './events.ts'

export { HttpError } from '@openhut/common/http-error.ts'
import { HttpError } from '@openhut/common/http-error.ts'

export function errorBody({ status, message, param }: { status: number; message: string; param?: string }): ApiError {
  return { error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', message, ...(param && { param }) } }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error && err.message === 'fetch failed' && err.cause instanceof Error) return err.cause.message
  return err instanceof Error ? err.message : String(err)
}

export function answerErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(errorBody(err))
    const status = err.statusCode ?? 500
    if (status >= 500) log.error({ event: 'http.error', error: err.message, stack: err.stack })
    return reply.status(status).send(errorBody({ status, message: status >= 500 ? 'Something went wrong. Try again.' : err.message }))
  })
}
