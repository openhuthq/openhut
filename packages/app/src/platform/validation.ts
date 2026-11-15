import * as z from 'zod/mini'
import type { FastifySchemaCompiler } from 'fastify'
import { HttpError } from './http-error.ts'

z.config(z.locales.en())

const PARTS: Record<string, string> = { body: 'The request body', querystring: 'The query string' }

export const validateWithZod: FastifySchemaCompiler<z.ZodMiniType> = ({ schema, httpPart }) => (data) => {
  const result = z.safeParse(schema, data)
  if (result.success) return { value: result.data }
  const [first] = result.error.issues
  return { error: new HttpError(400, `${PARTS[httpPart ?? ''] ?? 'The request'} is not valid. ${describeIssues(result.error.issues)}`, { param: first && paramOf(first) }) }
}

export const describeIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map((issue) => issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message).join('; ')

function paramOf(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code === 'unrecognized_keys') return [...issue.path, issue.keys[0]].join('.')
  return issue.path.length ? issue.path.join('.') : undefined
}
