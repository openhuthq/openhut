import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { bootCloud, hasCloud } from './real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

test('against the real cloud API: with the loopback port blocked, Google sign-in on the desktop completes with the code copied from the browser’s last page', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  await app.register(cloudController, { prefix: '/api/cloud' })
  const headers = { authorization: 'Bearer test-key' }
  const paste = (code: string) => app.inject({ method: 'POST', url: '/api/cloud/sessions/codes', headers, payload: { code } })
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    const google = await (await fetch(started.authorizationUrl)).text()
    const link = /href="([^"]+)">mo@example.com</.exec(google)?.[1]?.replaceAll('&amp;', '&') ?? ''
    const last = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location') ?? 'http://none/')
    assert.equal(last.pathname, '/v1/signed-in', 'the browser ends on the Cloud’s last page, not straight on the loopback')
    assert.match(new URL(last.searchParams.get('to') ?? '').href, /^http:\/\/127\.0\.0\.1:\d+\/api\/cloud\/callback\?/)
    const page = await (await fetch(last)).text()
    const copied = (JSON.parse(/const d=(\{.*?\});/.exec(page)?.[1] ?? '{}') as { code?: string }).code ?? ''
    assert.ok(copied.includes('.'))

    const wrong = await paste(`${copied.split('.')[0]}.not-the-code`)
    assert.equal(wrong.statusCode, 400, wrong.body)
    const stranger = await paste('some-other-state.code')
    assert.equal(stranger.statusCode, 400)
    assert.match(stranger.json<{ error: { message: string } }>().error.message, /expired/)

    const again = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    const link2 = /href="([^"]+)">mo@example.com</.exec(await (await fetch(again.authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&') ?? ''
    const last2 = new URL((await fetch(link2, { redirect: 'manual' })).headers.get('location') ?? 'http://none/')
    const code = (JSON.parse(/const d=(\{.*?\});/.exec(await (await fetch(last2)).text())?.[1] ?? '{}') as { code?: string }).code ?? ''
    const signedIn = await paste(` ${code}\n`)
    assert.equal(signedIn.statusCode, 200, signedIn.body)
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const status = (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string; email: string }>()
    assert.deepEqual({ status: status.status, email: status.email }, { status: 'on', email: 'mo@example.com' })
    assert.equal((await paste(code)).statusCode, 400, 'a code works once')
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
