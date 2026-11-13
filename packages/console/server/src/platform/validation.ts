import * as z from 'zod/mini'
import type { FastifySchemaCompiler } from 'fastify'

z.config(z.locales.en())

const PARTS: Record<string, string> = { body: 'The request body', params: 'The URL', querystring: 'The query string', headers: 'The request headers' }

export class InvalidRequest extends Error {
  statusCode = 400
  param?: string

  constructor(message: string, param?: string) {
    super(message)
    this.param = param
  }
}

export const validateWithZod: FastifySchemaCompiler<z.ZodMiniType> = ({ schema, httpPart }) => (data) => {
  const result = z.safeParse(schema, data)
  if (result.success) return { value: result.data }
  const [first] = result.error.issues
  return { error: new InvalidRequest(`${PARTS[httpPart ?? ''] ?? 'The request'} is not valid. ${describeIssues(result.error.issues)}`, first && paramOf(first)) }
}

export const describeIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map((issue) => issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message).join('; ')

function paramOf(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code === 'unrecognized_keys') return [...issue.path, issue.keys[0]].join('.')
  return issue.path.length ? issue.path.join('.') : undefined
}
