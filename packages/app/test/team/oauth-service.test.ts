import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { migrate } from '../../src/platform/db.ts'
import { oauthService } from '../../src/team/oauth-service.ts'
import { teamService } from '../../src/team/team-service.ts'

await migrate()
const { person: owner } = await teamService.createPerson({ setupCode: 'test-setup-code', username: 'oauthowner', password: 'owner-password-1', origin: 'http://jb.test' })
const redirectUri = 'http://localhost:4321/callback'
const verifier = randomBytes(32).toString('base64url')
const codeChallenge = createHash('sha256').update(verifier).digest('base64url')

const approved = async (clientId: string) => {
  const { redirect } = await oauthService.decide({ person: owner, clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', allow: true })
  return new URL(redirect ?? '').searchParams.get('code') ?? ''
}

test('a code with the wrong verifier is refused with an RFC error', async () => {
  const { client_id: clientId } = await oauthService.register({ name: 'test app', redirectUris: [redirectUri] })
  const code = await approved(clientId)
  await assert.rejects(oauthService.token({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(43), client_id: clientId, redirect_uri: redirectUri }), { code: 'invalid_grant' })
})

test('the right verifier gives tokens that name the person, and refresh rotates them', async () => {
  const { client_id: clientId } = await oauthService.register({ name: 'test app', redirectUris: [redirectUri] })
  const tokens = await oauthService.token({ grant_type: 'authorization_code', code: await approved(clientId), code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri })
  assert.equal(await oauthService.owner(tokens.access_token), owner.id)
  const rotated = await oauthService.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
  assert.notEqual(rotated.access_token, tokens.access_token)
  assert.equal(await oauthService.owner(tokens.access_token), undefined)
  await assert.rejects(oauthService.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }), { code: 'invalid_grant' })
})

test('denying sends the app access_denied, and a code works once', async () => {
  const { client_id: clientId } = await oauthService.register({ name: 'test app', redirectUris: [redirectUri] })
  const denied = await oauthService.decide({ person: owner, clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', allow: false })
  assert.equal(new URL(denied.redirect ?? '').searchParams.get('error'), 'access_denied')
  const code = await approved(clientId)
  await oauthService.token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri })
  await assert.rejects(oauthService.token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri }), { code: 'invalid_grant' })
})
