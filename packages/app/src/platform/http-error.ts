import type { FastifyError, FastifyInstance } from 'fastify'
import type { ApiError } from '@jakebox/common/api.ts'
import { log } from './events.ts'
import { InvalidRequest } from './validation.ts'

export class HttpError extends Error {
  readonly status: number
  readonly param?: string

  constructor(status: number, message: string, detail: { param?: string } = {}) {
    super(message)
    this.status = status
    this.param = detail.param
  }
}

export class OAuthError extends HttpError {
  readonly code: string

  constructor(code: string, description: string) {
    super(400, description)
    this.code = code
  }
}

export function errorBody({ status, message, param }: { status: number; message: string; param?: string }): ApiError {
  return { error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', message, ...(param && { param }) } }
}

export function answerErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof OAuthError) return reply.status(err.status).send({ error: err.code, error_description: err.message })
    if (err instanceof HttpError) return reply.status(err.status).send(errorBody(err))
    if (err instanceof InvalidRequest) return reply.status(400).send(errorBody({ status: 400, message: err.message, param: err.param }))
    const status = err.statusCode ?? 500
    if (status >= 500) log.error({ event: 'http.error', error: err.message, stack: err.stack })
    return reply.status(status).send(errorBody({ status, message: status >= 500 ? 'Something went wrong on our side. Try again.' : err.message }))
  })
}
