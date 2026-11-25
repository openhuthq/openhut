import type { FastifyError, FastifyInstance } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import type { ApiError } from '@openhut/common/api.ts'
import { log } from './events.ts'

export { HttpError } from '@openhut/common/http-error.ts'
import { HttpError } from '@openhut/common/http-error.ts'

const PARTS: Record<string, string> = { body: 'The request body', querystring: 'The query string' }

z.config(z.locales.en())

// fastify-type-provider-zod validates; this turns its error into our 400 shape, naming the first bad field.
function invalidInput(err: FastifyError): HttpError | undefined {
  if (!hasZodFastifySchemaValidationErrors(err)) return undefined
  const fields = err.validation.map((issue) => ({ path: issue.instancePath.split('/').filter(Boolean).join('.'), issue }))
  const first = fields[0]
  const param = first && (first.issue.keyword === 'unrecognized_keys' ? [first.path, (first.issue.params.keys as string[])[0]].filter(Boolean).join('.') : first.path)
  return new HttpError(400, `${PARTS[err.validationContext ?? ''] ?? 'The request'} is not valid. ${fields.map(({ path, issue }) => path ? `${path}: ${issue.message}` : issue.message).join('; ')}`, { param: param || undefined })
}

export const describeIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map((issue) => issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message).join('; ')

export function errorBody({ status, message, param }: { status: number; message: string; param?: string }): ApiError {
  return { error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', message, ...(param && { param }) } }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error && err.message === 'fetch failed' && err.cause instanceof Error) return err.cause.message
  return err instanceof Error ? err.message : String(err)
}

export function answerErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const known = err instanceof HttpError ? err : invalidInput(err)
    if (known) return reply.status(known.status).send(errorBody(known))
    const status = err.statusCode ?? 500
    if (status >= 500) log.error({ event: 'http.error', error: err.message, stack: err.stack })
    return reply.status(status).send(errorBody({ status, message: status >= 500 ? 'Something went wrong. Try again.' : err.message }))
  })
}
