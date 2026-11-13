import type { FastifyPluginAsync } from 'fastify'
import { CreateOAuthCode, type OAuthCode } from '@jakebox/common/team/oauth.ts'
import { deleted, listOf } from '../platform/responses.ts'
import { who } from './identity.ts'
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

  app.get<{ Params: { id: string } }>('/clients/:id', async (req) => {
    await who(req)
    return oauthService.client(req.params.id)
  })

  app.post<{ Body: CreateOAuthCode }>('/codes', CodeRequest, async (req): Promise<OAuthCode> => {
    const u = await who(req)
    const { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, allow } = req.body
    const client = await oauthService.client(clientId)
    if (!allow) return { object: 'oauth_code', redirect: client.redirectUris.includes(redirectUri) ? oauthService.denied({ redirectUri, state }) : null }
    return { object: 'oauth_code', ...await oauthService.approve({ userId: u.id, clientId, redirectUri, challenge: codeChallenge, method: codeChallengeMethod, state }) }
  })

  app.post<{ Body: Record<string, unknown> }>('/token', async (req, reply) => reply.header('cache-control', 'no-store').send(await oauthService.token(req.body ?? {})))

  app.post<{ Body: { token?: string } }>('/revocations', async (req) => {
    if (typeof req.body?.token === 'string') await oauthService.revokeToken(req.body.token)
    return {}
  })

  app.get('/grants', async (req) => listOf({ req, data: await oauthService.grants((await who(req)).id) }))

  app.delete<{ Params: { id: string } }>('/grants/:id', async (req) => {
    await oauthService.revoke({ userId: (await who(req)).id, id: req.params.id })
    return deleted({ id: req.params.id, object: 'oauth_grant' })
  })
}

const CodeRequest = { schema: { body: CreateOAuthCode } }
