import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { ApiError } from '@openhut/common/api.ts'
import { serveMcp } from '../platform/mcp-transport.ts'
import { innerAuthorization, who } from '../team/identity.ts'
import { mcpService } from './mcp-service.ts'
import type { Api } from './mcp-tools.ts'

export const mcpController: FastifyPluginAsync = async (app) => {
  app.all('/', async (req, reply) => serveControlMcp({ app, req, reply }))
}

async function serveControlMcp({ app, req, reply }: { app: FastifyInstance; req: FastifyRequest; reply: FastifyReply }): Promise<void> {
  const authorization = innerAuthorization(await who(req))
  reply.hijack()
  await serveMcp({ server: mcpService.server({ api: apiAs({ app, authorization }) }), req: req.raw, res: reply.raw, body: req.body })
}

function apiAs({ app, authorization }: { app: FastifyInstance; authorization: string }): Api {
  return async ({ method, url, payload }) => {
    const headers = { authorization, ...(payload !== undefined && { 'content-type': 'application/json' }) }
    const res = await app.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers })
    const body: unknown = res.body ? JSON.parse(res.body) : null
    if (res.statusCode >= 400) throw new Error(messageOf(body) ?? `OpenHut answered ${res.statusCode}. Try again.`)
    return body
  }
}

function messageOf(body: unknown): string | undefined {
  return z.safeParse(ApiError, body).data?.error.message
}
