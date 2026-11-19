import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { migrate } from '../../../src/server/platform/db.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'
import { connectionAuthorizationController } from '../../../src/server/connections/connection-controller.ts'

await migrate()

test('a sign-in that comes back expired goes back into the app with the reason', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validateWithZod)
  await app.register(connectionAuthorizationController, { prefix: '/api/connection-authorizations' })
  const back = () => app.inject({ method: 'GET', url: '/api/connection-authorizations/callback?state=gone&code=x' })

  const local = await back()
  assert.equal(local.statusCode, 302)
  assert.match(local.headers.location ?? '', /^\/connections\?error=This%20sign-in%20expired/)
})
