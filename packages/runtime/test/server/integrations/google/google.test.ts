import { test } from 'node:test'
import assert from 'node:assert/strict'

const { migrate } = await import('../../../../src/server/platform/db.ts')
await migrate()
const { settings } = await import('../../../../src/server/platform/settings.ts')
const { google } = await import('../../../../src/server/integrations/google/google.ts')

test('Google sign-in needs the team\'s own OAuth client, and then asks Google directly with PKCE and offline access', async () => {
  await assert.rejects(google.beginSignIn({ kind: 'gmail', redirectUri: 'http://127.0.0.1:8787/cb', state: 's' }), { status: 409 })
  await settings.setGoogleClient({ id: 'client-1.apps.googleusercontent.com', secret: 'secret' })
  const { authorizationUrl, verifier } = await google.beginSignIn({ kind: 'gmail', redirectUri: 'http://127.0.0.1:8787/cb', state: 's' })
  const url = new URL(authorizationUrl)
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('client_id'), 'client-1.apps.googleusercontent.com')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8787/cb')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.match(url.searchParams.get('scope') ?? '', /gmail\.modify/)
  assert.ok(verifier.length > 40)
})
