import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seatToken, signInLink } from '../../src/admin/seat-sign-in.ts'

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz'

test('the sign-in link comes whole from the terminal hyperlink, not the wrapped text', () => {
  const out = `\x1b[2mBrowser didn't open? Use the url below to sign in\x1b[22m\r\n\x1b]8;id=1jg14s;${URL}\x1b\\${URL.slice(0, 80)}\x1b]8;;\x1b\\\r\nPaste code here if prompted >`
  assert.equal(signInLink(out), URL)
  assert.equal(signInLink('Paste code here if prompted >'), undefined)
})

test('the seat token is found through terminal colours and carriage returns', () => {
  const token = `sk-ant-oat01-${'a1B2_c-'.repeat(14)}AA`
  assert.equal(seatToken(`\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n\x1b[1m${token}\x1b[22m\r\n\r\nStore this token securely.`), token)
  assert.equal(seatToken('OAuth error: invalid code'), undefined)
})
