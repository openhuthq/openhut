import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { ApiError } from '@fastmonkey/common/api.ts'
import { errorBody } from '../platform/http-error.ts'
import { serveMcp } from '../platform/mcp-transport.ts'
import { publicUrl } from '../platform/settings.ts'
import { callerOf } from '../team/identity.ts'
import { ACCESS_TOKEN } from '../team/oauth-service.ts'
import { mcpService } from './mcp-service.ts'
import type { Api } from './mcp-tools.ts'

export const mcpController: FastifyPluginAsync = async (app) => {
  app.all('/', async (req, reply) => serveControlMcp({ app, req, reply }))
}

async function serveControlMcp({ app, req, reply }: { app: FastifyInstance; req: FastifyRequest; reply: FastifyReply }): Promise<void> {
  const signedIn = ACCESS_TOKEN.test(req.headers.authorization ?? '') && await callerOf(req)
  if (!signedIn) {
    return reply.status(401).header('www-authenticate', `Bearer resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource/mcp"`)
      .send(errorBody({ status: 401, message: 'Sign in to Fast Monkey to use its tools.' }))
  }
  reply.hijack()
  await serveMcp({ server: mcpService.server({ api: apiAs({ app, req }) }), req: req.raw, res: reply.raw, body: req.body })
}

function apiAs({ app, req }: { app: FastifyInstance; req: FastifyRequest }): Api {
  return async ({ method, url, payload }) => {
    const headers = { authorization: req.headers.authorization ?? '', ...(payload !== undefined && { 'content-type': 'application/json' }) }
    const res = await app.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers })
    const body: unknown = res.body ? JSON.parse(res.body) : null
    if (res.statusCode >= 400) throw new Error(messageOf(body) ?? `Fast Monkey answered ${res.statusCode}. Try again.`)
    return body
  }
}

function messageOf(body: unknown): string | undefined {
  return z.safeParse(ApiError, body).data?.error.message
}
