import { test } from 'node:test'
import assert from 'node:assert/strict'
import { challengeOf, pkce } from '../src/oauth.ts'

test('the challenge is the base64url SHA-256 of the verifier, as in RFC 7636 appendix B', () => {
  assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('every verifier is new and has the shape JakeBox accepts', () => {
  const first = pkce()
  const second = pkce()
  assert.match(first.verifier, /^[\w-]{43,128}$/)
  assert.match(first.challenge, /^[\w-]{43}$/)
  assert.equal(first.challenge, challengeOf(first.verifier))
  assert.notEqual(first.verifier, second.verifier)
})
