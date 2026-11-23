import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inviteOf } from '../../../src/features/join/invite.ts'

const secret = `${'A'.repeat(42)}Q`
const email = Buffer.from('ana@example.com').toString('base64url')

test('an invite hash gives the link the runtime takes, its team, and the email it was sent to', () => {
  assert.deepEqual(inviteOf(`#${email}#ws_Abc-123.${secret}`), { link: `https://openhut.dev/join#ws_Abc-123.${secret}`, workspace: 'ws_Abc-123', email: 'ana@example.com' })
  assert.deepEqual(inviteOf(`#ws_Abc-123.${secret}`), { link: `https://openhut.dev/join#ws_Abc-123.${secret}`, workspace: 'ws_Abc-123', email: undefined })
})

test('a hash that isn\'t an invite gives nothing, and a broken email part is left out', () => {
  for (const hash of ['', '#', '#nope', `#ws.${secret}`, `ws_Abc-123.${secret}`, `##ws_Abc-123.${secret}`, `#ws_Abc-123.${secret}.${email}`, `#a#b#ws_Abc-123.${secret}`]) assert.equal(inviteOf(hash), undefined, hash)
  assert.equal(inviteOf(`#${Buffer.from('not an email').toString('base64url')}#ws_Abc-123.${secret}`)?.email, undefined)
  assert.equal(inviteOf(`#%%%#ws_Abc-123.${secret}`), undefined)
})
