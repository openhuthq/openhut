import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codex } from '../../../../src/server/integrations/codex/codex.ts'
import { settings } from '../../../../src/server/platform/settings.ts'

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`

test('an expiring ChatGPT token is refreshed once for everyone waiting, and the rotated refresh token is kept', async (t) => {
  const fresh = jwt(Math.floor(Date.now() / 1000) + 3600)
  await settings.setCodexTokens({ accessToken: jwt(Math.floor(Date.now() / 1000) + 60), refreshToken: 'r1' })
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(String(init.body))
    await new Promise((resolve) => setTimeout(resolve, 50))
    return new Response(JSON.stringify({ access_token: fresh, refresh_token: 'r2' }), { status: 200 })
  })
  assert.deepEqual(await Promise.all([codex.accessToken(), codex.accessToken(), codex.accessToken()]), [fresh, fresh, fresh])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /grant_type=refresh_token&refresh_token=r1&client_id=/)
  assert.deepEqual(settings.codexTokens(), { accessToken: fresh, refreshToken: 'r2' })
  assert.equal(await codex.accessToken(), fresh)
  assert.equal(sent.length, 1)
})
