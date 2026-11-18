import { chmodSync, rmSync } from 'node:fs'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { config } from './platform/config.ts'
import { db, migrate } from './platform/db.ts'
import { log } from './platform/events.ts'
import { answerErrors, errorBody, messageOf } from './platform/http-error.ts'
import { validateWithZod } from './platform/validation.ts'
import { adminController, healthController, updateController } from './admin/admin-controller.ts'
import { agentController, grantController } from './agents/agent-controller.ts'
import { memoryController } from './agents/memory-controller.ts'
import { browserController } from './agents/browser-controller.ts'
import { eventsController } from './platform/events-controller.ts'
import { startTelemetry } from './platform/telemetry.ts'
import { skillController } from './agents/skill-controller.ts'
import { agentService } from './agents/agent-service.ts'
import { channelController } from './channels/channel-controller.ts'
import { connectionAuthorizationController, connectionController, connectionEventController, connectionToolController } from './connections/connection-controller.ts'
import { providerController } from './models/provider-controller.ts'
import { gatewayServer } from './gateway/gateway-server.ts'
import { mcpController } from './mcp/mcp-controller.ts'
import { threadController } from './threads/thread-controller.ts'
import { meController } from './team/team-controller.ts'

if (!config.socket && !/^[0-9a-f]{64}$/i.test(config.clientKeySha256 ?? '')) {
  log.error({ event: 'app.no_client_key', message: 'Set OPENHUT_CLIENT_KEY_SHA256 to the hex SHA-256 of the key the OpenHut app enrolled, or OPENHUT_SOCKET for local mode. Refusing to start without either.' })
  process.exit(1)
}
await migrate()

const app = Fastify({ logger: false, bodyLimit: 1 << 20, trustProxy: ['127.0.0.1', '::1'], forceCloseConnections: true })
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
app.addHook('onSend', async (_req, reply) => {
  reply.header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY')
})

await app.register(websocket)
await app.register(healthController, { prefix: '/health' })
await app.register(meController, { prefix: '/api/me' })
await app.register(agentController, { prefix: '/api/agents' })
await app.register(grantController, { prefix: '/api/grants' })
await app.register(skillController, { prefix: '/api/skills' })
await app.register(memoryController, { prefix: '/api/memories' })
await app.register(browserController, { prefix: '/api/browsers' })
await app.register(threadController, { prefix: '/api/threads' })
await app.register(channelController, { prefix: '/api/channels' })
await app.register(connectionController, { prefix: '/api/connections' })
await app.register(connectionEventController, { prefix: '/api/connection-events' })
await app.register(connectionToolController, { prefix: '/api/connection-tools' })
await app.register(connectionAuthorizationController, { prefix: '/api/connection-authorizations' })
await app.register(providerController, { prefix: '/api/providers' })
await app.register(adminController, { prefix: '/api/admin' })
await app.register(eventsController, { prefix: '/api/events' })
await app.register(updateController, { prefix: '/api/updates' })
await app.register(mcpController, { prefix: '/mcp' })

app.setNotFoundHandler((req, reply) => reply.status(404).send(errorBody({ status: 404, message: `There's no ${req.method} ${req.url.split('?')[0]}.` })))

if (config.socket) rmSync(config.socket, { force: true })
const umask = process.umask(0o177)
await app.listen(config.socket ? { path: config.socket } : { port: config.port, host: config.host })
process.umask(umask)
if (config.socket) chmodSync(config.socket, 0o600)
process.once('SIGTERM', async () => {
  log.info({ event: 'app.stopping' })
  await app.close()
  await db.destroy()
  process.exit(0)
})
log.info({ event: 'app.listening', at: config.socket ?? config.port, build: config.build })
await startTelemetry()
await gatewayServer.start().catch(async (err: unknown) => {
  log.error({ event: 'gateway.bind_failed', port: config.gatewayPort, error: messageOf(err) })
  await agentService.stopAll()
  process.exit(1)
})
await agentService.boot()
