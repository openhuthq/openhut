import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../../../../src/server/platform/db.ts'
import { codex } from '../../../../src/server/integrations/codex/codex.ts'
import { keysService } from '../../../../src/server/cloud/keys-service.ts'
import { connectionRecords } from '../../../../src/server/connections/connection-records.ts'
import { providerService } from '../../../../src/server/models/provider-service.ts'
import { settings } from '../../../../src/server/platform/settings.ts'
import { useFakeRecords } from '../../cloud/records-fake.ts'

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`
await migrate()
const fake = useFakeRecords()
await keysService.open({ sub: 'dev-codex', email: 'owner@example.com' })

test('an expiring ChatGPT token is refreshed once under the lease, and the rotated refresh token is put to the cloud', async (t) => {
  const fresh = jwt(Math.floor(Date.now() / 1000) + 3600)
  await providerService.signedIn({ id: 'codex', secret: { accessToken: jwt(Math.floor(Date.now() / 1000) + 60), refreshToken: 'r1', at: new Date().toISOString() } })
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(String(init.body))
    await new Promise((resolve) => setTimeout(resolve, 50))
    return new Response(JSON.stringify({ access_token: fresh, refresh_token: 'r2' }), { status: 200 })
  })
  assert.deepEqual(await Promise.all([codex.accessToken(), codex.accessToken(), codex.accessToken()]), [fresh, fresh, fresh])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /grant_type=refresh_token&refresh_token=r1&client_id=/)
  const id = connectionRecords.providerId('codex')
  assert.deepEqual(fake.leases, [id])
  assert.match(JSON.stringify(fake.rows.get(id)?.secret), /"refreshToken":"r2"/)
  assert.deepEqual(settings.codexTokens(), { accessToken: fresh, refreshToken: 'r2' })
  assert.equal(await codex.accessToken(), fresh)
  assert.equal(sent.length, 1)
})

test('with the cloud down, an expiring ChatGPT token stops working instead of refreshing locally', async (t) => {
  await providerService.signedIn({ id: 'codex', secret: { accessToken: jwt(Math.floor(Date.now() / 1000) + 60), refreshToken: 'r3', at: new Date().toISOString() } })
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sent.push('token')
    return new Response('{}', { status: 200 })
  })
  await fake.offline(true)
  try {
    await assert.rejects(codex.accessToken(), (err: Error & { status?: number }) => err.status === 502)
    assert.equal(sent.length, 0)
  } finally {
    await fake.offline(false)
  }
})
