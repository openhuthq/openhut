import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

const seen: { path: string; authorization?: string }[] = []
const cloud = createServer((req, res) => {
  seen.push({ path: req.url ?? '', authorization: req.headers.authorization })
  const body = req.url === '/v1/oauth-authorizations'
    ? { id: 'a.b', object: 'oauth_authorization', provider: 'google', authorizationUrl: 'https://google.test/auth', expiresAt: new Date().toISOString() }
    : { object: 'oauth_token', provider: 'google', accessToken: 'ya29', refreshToken: '1//r', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [] }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
})
cloud.listen(0, '127.0.0.1')
await once(cloud, 'listening')
const address = cloud.address()
process.env.OPENHUT_API_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../../src/server/platform/db.ts')
await migrate()
const { keysService } = await import('../../../../src/server/cloud/keys-service.ts')
const { google } = await import('../../../../src/server/integrations/google/google.ts')
after(() => cloud.close())

const expired = { accessToken: 'old', refreshToken: '1//r', expiresAt: 0, email: 'mo@example.com' }

test('the Google sign-in and its refresh send this device’s cloud token to the OAuth broker', async () => {
  await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 'device-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  await google.beginSignIn({ kind: 'gmail', redirectUri: 'http://127.0.0.1:8787/cb', state: 's' })
  await google.finishSignIn({ code: 'c', verifier: 'v' })
  const refresh = async (renew: (latest: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
    await renew(expired)
    throw new Error('refreshed')
  }
  await assert.rejects(google.connector('gmail').tools({ config: expired, refresh }), /refreshed/)
  assert.deepEqual(seen, [
    { path: '/v1/oauth-authorizations', authorization: 'Bearer device-token' },
    { path: '/v1/oauth-tokens', authorization: 'Bearer device-token' },
    { path: '/v1/oauth-tokens', authorization: 'Bearer device-token' },
  ])
})

test('with no cloud session the call still goes out, without a token, until the Cloud requires one', async () => {
  seen.length = 0
  await keysService.setSession(undefined)
  await google.beginSignIn({ kind: 'gmail', redirectUri: 'http://127.0.0.1:8787/cb', state: 's' })
  assert.deepEqual(seen, [{ path: '/v1/oauth-authorizations', authorization: undefined }])
})
