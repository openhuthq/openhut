import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { migrate } from '../../../src/server/platform/db.ts'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { connectionAuthorizationController } from '../../../src/server/connections/connection-controller.ts'

await migrate()

test('a sign-in finishes in the browser: an expired one says so there', async () => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  await app.register(connectionAuthorizationController, { prefix: '/api/connection-authorizations' })
  const back = () => app.inject({ method: 'GET', url: '/api/connection-authorizations/callback?state=gone&code=x' })

  const local = await back()
  assert.equal(local.statusCode, 200)
  assert.match(local.headers['content-type'] ?? '', /text\/html/)
  assert.match(local.body, /This sign-in expired/)
})

test('the launch page escapes what it posts', async () => {
  const { posting } = await import('../../../src/server/platform/page.ts')
  const html = posting({ url: 'https://github.com/settings/apps/new?state=a&b', field: 'manifest', value: '{"name":"x\\"><script>"}' })
  assert.match(html, /action="https:\/\/github.com\/settings\/apps\/new\?state=a&#38;b"/)
  assert.doesNotMatch(html, /value="[^"]*<script>/)
})
