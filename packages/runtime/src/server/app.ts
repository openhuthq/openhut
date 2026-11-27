import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { config } from './platform/config.ts'
import { db, migrate } from './platform/db.ts'
import { emit, log } from './platform/events.ts'
import { answerErrors, messageOf } from './platform/http-error.ts'
import { webApp } from './platform/web-app.ts'
import { writeCaddyfile } from './platform/address.ts'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { adminController, healthController, updateController } from './admin/admin-controller.ts'
import { agentController } from './agents/agent-controller.ts'
import { memoryController } from './agents/memory-controller.ts'
import { eventsController } from './platform/events-controller.ts'
import { skillController } from './agents/skill-controller.ts'
import { agentService } from './agents/agent-service.ts'
import { gatewayServer } from './gateway/gateway-server.ts'
import { addressController, googleSignInController, inviteController, meController, ownerResetController, passwordResetController, peopleController, installSettingsController, sessionController, setupController } from './team/team-controller.ts'
import { installSettingsService } from './team/install-settings-service.ts'
import { startDurable } from '../core/durable.ts'
import { runSet } from './agents/run-set.ts'
import { computerController } from './computers/computer-controller.ts'
import { computerService } from './computers/computer-service.ts'
import { listenLocally } from './team/identity.ts'
import { plugins, startPlugins } from '../core/plugins.ts'

await migrate()
writeCaddyfile()
await computerService.boot()

const app = Fastify({ logger: false, bodyLimit: 1 << 20, trustProxy: (address: string, hop: number) => hop === 0 && (config.behindProxy || address === '127.0.0.1'), forceCloseConnections: true }).withTypeProvider<ZodTypeProvider>()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
app.addHook('onSend', async (_req, reply) => {
  reply.header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY').header('x-openhut-build', config.build)
})

await app.register(websocket, { options: { maxPayload: 1 << 20 } })
await app.register(healthController, { prefix: '/health' })
await app.register(meController, { prefix: '/api/me' })
await app.register(setupController, { prefix: '/api/setup' })
await app.register(ownerResetController, { prefix: '/api/owner-resets' })
await app.register(addressController, { prefix: '/api/addresses' })
await app.register(peopleController, { prefix: '/api/people' })
await app.register(sessionController, { prefix: '/api/sessions' })
await app.register(inviteController, { prefix: '/api/invites' })
await app.register(passwordResetController, { prefix: '/api/password-resets' })
await app.register(googleSignInController, { prefix: '/api/google-sign-in' })
await app.register(installSettingsController, { prefix: '/api/install-settings' })
await app.register(computerController, { prefix: '/api/computers' })
await app.register(agentController, { prefix: '/api/agents' })
await app.register(skillController, { prefix: '/api/skills' })
await app.register(memoryController, { prefix: '/api/memories' })
for (const plugin of plugins()) {
  for (const [prefix, routes] of Object.entries(plugin.routes?.() ?? {})) await app.register(routes, { prefix })
}
await app.register(adminController, { prefix: '/api/admin' })
await app.register(eventsController, { prefix: '/api/events' })
await app.register(updateController, { prefix: '/api/updates' })

app.setNotFoundHandler(webApp)

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
await gatewayServer.start().catch(async (err: unknown) => {
  log.error({ event: 'gateway.bind_failed', port: config.gatewayPort, error: messageOf(err) })
  await agentService.stopAll()
  process.exit(1)
})
await startDurable()
await runSet.start()
await agentService.boot()
startPlugins()
installSettingsService.startUsageData()
