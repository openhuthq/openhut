import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { config } from './platform/config.ts'
import { migrate } from './platform/db.ts'
import { log } from './platform/events.ts'
import { answerErrors, errorBody } from './platform/http-error.ts'
import { validateWithZod } from './platform/validation.ts'
import { adminController, healthController } from './admin/admin-controller.ts'
import { agentController, grantController } from './agents/agent-controller.ts'
import { agentService } from './agents/agent-service.ts'
import { channelController } from './channels/channel-controller.ts'
import { connectionController, connectionEventController } from './connections/connection-controller.ts'
import { gatewayServer } from './gateway/gateway-server.ts'
import { mcpController } from './mcp/mcp-controller.ts'
import { oauthController, oauthMetadataController } from './team/oauth-controller.ts'
import { inviteController, inviteLinkController, meController, peopleController, sessionController, setupController } from './team/team-controller.ts'

await migrate()

const app = Fastify({ logger: false, bodyLimit: 1 << 20 })
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
app.addHook('onSend', async (_req, reply) => {
  reply.header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY')
})

await app.register(healthController, { prefix: '/health' })
await app.register(setupController, { prefix: '/api/setup' })
await app.register(peopleController, { prefix: '/api/people' })
await app.register(sessionController, { prefix: '/api/sessions' })
await app.register(meController, { prefix: '/api/me' })
await app.register(inviteController, { prefix: '/api/invites' })
await app.register(inviteLinkController, { prefix: '/api/invite-links' })
await app.register(oauthController, { prefix: '/api/oauth' })
await app.register(oauthMetadataController)
await app.register(agentController, { prefix: '/api/agents' })
await app.register(grantController, { prefix: '/api/grants' })
await app.register(channelController, { prefix: '/api/channels' })
await app.register(connectionController, { prefix: '/api/connections' })
await app.register(connectionEventController, { prefix: '/api/connection-events' })
await app.register(adminController, { prefix: '/api/admin' })
await app.register(mcpController, { prefix: '/mcp' })

const web = fileURLToPath(config.webDist)
if (existsSync(web)) await app.register(fastifyStatic, { root: web, wildcard: false })
app.setNotFoundHandler((req, reply) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(`${web}/index.html`)) return reply.type('text/html').sendFile('index.html')
  return reply.status(404).send(errorBody({ status: 404, message: `There's no ${req.method} ${req.url.split('?')[0]}.` }))
})

await app.listen({ port: config.port, host: '0.0.0.0' })
log.info({ event: 'app.listening', port: config.port, build: config.build })
gatewayServer.start()
await agentService.boot()
