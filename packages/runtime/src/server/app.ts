import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { config } from './platform/config.ts'
import { db, migrate } from './platform/db.ts'
import { emit, log } from './platform/events.ts'
import { answerErrors, errorBody, messageOf } from './platform/http-error.ts'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { adminController, healthController, updateController } from './admin/admin-controller.ts'
import { agentController, grantController } from './agents/agent-controller.ts'
import { memoryController } from './agents/memory-controller.ts'
import { browserController } from './agents/browser-controller.ts'
import { eventsController } from './platform/events-controller.ts'
import { skillController } from './agents/skill-controller.ts'
import { agentService } from './agents/agent-service.ts'
import { channelController } from './channels/channel-controller.ts'
import { channelService } from './channels/channel-service.ts'
import { connectionAuthorizationController, connectionController, connectionEventController, connectionToolController } from './connections/connection-controller.ts'
import { creditsController } from './models/credits-controller.ts'
import { providerController } from './models/provider-controller.ts'
import { gatewayServer } from './gateway/gateway-server.ts'
import { threadController } from './threads/thread-controller.ts'
import { threadService } from './threads/thread-service.ts'
import { routineController } from './routines/routine-controller.ts'
import { changeRequestController } from './agents/change-request-controller.ts'
import { changeRequestService } from './agents/change-request-service.ts'
import { routineService } from './routines/routine-service.ts'
import { meController } from './team/team-controller.ts'
import { invitationController } from './cloud/invite-controller.ts'
import { forward, forwardController } from './relay/forward.ts'
import { relayService } from './relay/relay-service.ts'
import { cloudController } from './cloud/cloud-controller.ts'
import { cloudService } from './cloud/cloud-service.ts'
import { runSet } from './cloud/run-set.ts'
import { settings } from './platform/settings.ts'
import { listenLocally } from './team/identity.ts'
import { keysService } from './cloud/keys-service.ts'

await migrate()
if (config.installKind === 'server' && !/^[0-9a-f]{64}$/i.test(config.clientKeySha256 ?? '') && !config.join && !keysService.session() && !settings.access()) {
  log.error({ event: 'app.no_client_key', message: 'Set OPENHUT_JOIN to a join code from the OpenHut app, OPENHUT_CLIENT_KEY_SHA256 to the hex SHA-256 of the key the app enrolled, or OPENHUT_SOCKET for local mode. Refusing to start without one.' })
  process.exit(1)
}

const app = Fastify({ logger: false, bodyLimit: 1 << 20, trustProxy: ['127.0.0.1', '::1'], forceCloseConnections: true }).withTypeProvider<ZodTypeProvider>()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
app.addHook('onRequest', async (req) => {
  const zone = req.headers['openhut-time-zone']
  if (typeof zone === 'string' && zone) await routineService.setTimeZone(zone)
})
app.addHook('onSend', async (_req, reply) => {
  reply.header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY')
})

await app.register(websocket)
app.addHook('preHandler', forward.http)
await app.register(healthController, { prefix: '/health' })
await app.register(meController, { prefix: '/api/me' })
await app.register(invitationController, { prefix: '/api/invitations' })
await app.register(agentController, { prefix: '/api/agents' })
await app.register(grantController, { prefix: '/api/grants' })
await app.register(skillController, { prefix: '/api/skills' })
await app.register(memoryController, { prefix: '/api/memories' })
await app.register(browserController, { prefix: '/api/browsers' })
await app.register(threadController, { prefix: '/api/threads' })
await app.register(routineController, { prefix: '/api/routines' })
await app.register(changeRequestController, { prefix: '/api/change-requests' })
await app.register(channelController, { prefix: '/api/channels' })
await app.register(connectionController, { prefix: '/api/connections' })
await app.register(connectionEventController, { prefix: '/api/connection-events' })
await app.register(connectionToolController, { prefix: '/api/connection-tools' })
await app.register(connectionAuthorizationController, { prefix: '/api/connection-authorizations' })
await app.register(providerController, { prefix: '/api/providers' })
await app.register(creditsController, { prefix: '/api/credits' })
await app.register(adminController, { prefix: '/api/admin' })
await app.register(eventsController, { prefix: '/api/events' })
await app.register(updateController, { prefix: '/api/updates' })
await app.register(cloudController, { prefix: '/api/cloud' })
await app.register(forwardController, { prefix: '/c' })

app.setNotFoundHandler((req, reply) => reply.status(404).send(errorBody({ status: 404, message: `There's no ${req.method} ${req.url.split('?')[0]}.` })))

if (config.installKind === 'server') await app.listen({ port: config.port, host: config.host })
else await app.ready()
const local = await listenLocally({ server: app.server, path: config.socket })
process.once('SIGTERM', async () => {
  log.info({ event: 'app.stopping' })
  local.close()
  await app.close()
  await db.destroy()
  process.exit(0)
})
emit({ name: 'app.started', properties: { at: config.installKind === 'server' ? config.port : config.socket, build: config.build, version: config.version, kind: config.installKind } })
relayService.start({ server: app.server }).catch((err: unknown) => log.error({ event: 'relay.start_failed', error: messageOf(err) }))
await gatewayServer.start().catch(async (err: unknown) => {
  log.error({ event: 'gateway.bind_failed', port: config.gatewayPort, error: messageOf(err) })
  await agentService.stopAll()
  process.exit(1)
})
await runSet.start()
await agentService.boot()
routineService.runDashboardWith((input) => threadService.runRoutine(input))
changeRequestService.runDashboardWith((input) => threadService.runRoutine(input))
void changeRequestService.resume().catch((err: unknown) => log.warn({ event: 'change_request.resume_failed', error: messageOf(err) }))
routineService.start()
void channelService.resumeTelegramClaims().catch((err: unknown) => log.warn({ event: 'telegram.claim_resume_failed', error: messageOf(err) }))
cloudService.connect()
