import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { errorBody } from '../platform/http-error.ts'
import { publicUrl } from '../platform/settings.ts'
import { callerOf } from '../team/identity.ts'
import { ACCESS_TOKEN } from '../team/oauth-service.ts'
import { mcpService } from './mcp-service.ts'
import type { Api } from './mcp-tools.ts'

export const mcpController: FastifyPluginAsync = async (app) => {
  app.all('/', async (req, reply) => {
    const signedIn = ACCESS_TOKEN.test(req.headers.authorization ?? '') && await callerOf(req)
    if (!signedIn) {
      return reply.status(401).header('www-authenticate', `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource/mcp"`)
        .send(errorBody({ status: 401, message: 'Sign in to JakeBox to use its tools.' }))
    }
    const server = mcpService.server({ api: apiAs({ app, req }) })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
}

function apiAs({ app, req }: { app: FastifyInstance; req: FastifyRequest }): Api {
  return async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { authorization: req.headers.authorization ?? '', ...(payload !== undefined && { 'content-type': 'application/json' }) } })
    const body: unknown = res.body ? JSON.parse(res.body) : null
    if (res.statusCode >= 400) throw new Error(messageOf(body) ?? `JakeBox answered ${res.statusCode}.`)
    return body
  }
}

function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  const { error } = body
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : undefined
}
