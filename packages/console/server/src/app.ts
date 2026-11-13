import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { config } from './platform/config.ts'
import { migrate } from './platform/db.ts'
import { log } from './platform/events.ts'
import { answerErrors, errorBody } from './platform/http-error.ts'
import { validateWithZod } from './platform/validation.ts'
import { installController } from './installs/install-controller.ts'
import { releaseController } from './releases/release-controller.ts'

await migrate()

export const app = Fastify({ logger: false, bodyLimit: 64 << 10 })
answerErrors(app)
app.setValidatorCompiler(validateWithZod)

await app.register(releaseController, { prefix: '/api/releases' })
await app.register(installController, { prefix: '/api/installs' })

const web = fileURLToPath(config.webDist)
if (existsSync(web)) await app.register(fastifyStatic, { root: web })
app.setNotFoundHandler((req, reply) => reply.status(404).send(errorBody({ status: 404, message: `There's no ${req.method} ${req.url.split('?')[0]}.` })))

await app.listen({ port: config.port, host: '0.0.0.0' })
log.info({ event: 'console.listening', port: config.port })
