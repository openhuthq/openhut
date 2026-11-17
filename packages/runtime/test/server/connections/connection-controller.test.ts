import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { migrate } from '../../../src/server/platform/db.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'
import { connectionAuthorizationController } from '../../../src/server/connections/connection-controller.ts'

await migrate()

test('a sign-in returning to a remote computer ends on a plain page; on this Mac it goes back into the app', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validateWithZod)
  await app.register(connectionAuthorizationController, { prefix: '/api/connection-authorizations' })
  const back = () => app.inject({ method: 'GET', url: '/api/connection-authorizations/callback?state=gone&code=x' })

  const local = await back()
  assert.equal(local.statusCode, 302)
  assert.match(local.headers.location ?? '', /^\/connections\?error=This%20sign-in%20expired/)

  await settings.setTailnetUrl('https://beelink.example.ts.net')
  const remote = await back()
  assert.equal(remote.statusCode, 400)
  assert.match(remote.headers['content-type'] ?? '', /^text\/html/)
  assert.match(remote.body, /This sign-in expired or was already used\. Start it again\./)
  await settings.setTailnetUrl(null)
})
