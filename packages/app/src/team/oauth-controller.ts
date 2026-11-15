import type { FastifyPluginAsync } from 'fastify'
import { CreateOAuthCode, type OAuthCode } from '@openhut/common/team/oauth.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from './identity.ts'
import { oauthService } from './oauth-service.ts'

export const oauthMetadataController: FastifyPluginAsync = async (app) => {
  app.get('/.well-known/oauth-protected-resource', async () => oauthService.resourceMetadata())
  app.get('/.well-known/oauth-protected-resource/*', async () => oauthService.resourceMetadata())
  app.get('/.well-known/oauth-authorization-server', async () => oauthService.serverMetadata())
  app.get('/.well-known/oauth-authorization-server/*', async () => oauthService.serverMetadata())
}

export const oauthController: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))))

  app.post<{ Body: { client_name?: unknown; redirect_uris?: unknown } }>('/clients', async (req, reply) => reply.status(201).send(await oauthService.register({ name: req.body?.client_name, redirectUris: req.body?.redirect_uris })))

  app.get<{ Params: { id: string } }>('/clients/:id', SignedIn, async (req) => oauthService.client(req.params.id))

  app.post<{ Body: CreateOAuthCode }>('/codes', CodeRequest, async (req): Promise<OAuthCode> => oauthService.decide({ person: await who(req), ...req.body }))

  app.post<{ Body: Record<string, unknown> }>('/token', async (req, reply) => reply.header('cache-control', 'no-store').send(await oauthService.token(req.body ?? {})))

  app.get('/grants', async (req) => listOf({ req, data: await oauthService.grants((await who(req)).id) }))

  app.delete<{ Params: { id: string } }>('/grants/:id', async (req) => oauthService.revoke({ person: await who(req), id: req.params.id }))
}

const SignedIn = { onRequest: requireSignIn }
const CodeRequest = { schema: { body: CreateOAuthCode } }
