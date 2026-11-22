import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inviteLink } from '../src/invite-link.mjs'

const secret = 'A'.repeat(42) + 'Q'
const link = `https://openhut.dev/join#ws_Abc-123.${secret}`

test('an invite link on the clipboard is taken as it is, around its whitespace', () => {
  assert.equal(inviteLink(link), link)
  assert.equal(inviteLink(`  ${link}\n`), link)
})

test('anything else on the clipboard is ignored', () => {
  for (const text of [
    '', undefined, null, 'hello', 'my password is hunter2',
    'https://openhut.dev/join', 'https://openhut.dev/join#', 'https://openhut.dev/join#ws_Abc-123',
    `http://openhut.dev/join#ws_Abc-123.${secret}`, `https://evil.dev/join#ws_Abc-123.${secret}`,
    `https://openhut.dev.evil.dev/join#ws_Abc-123.${secret}`, `https://openhut.dev/joins#ws_Abc-123.${secret}`,
    `https://openhut.dev/join?x=1#ws_Abc-123.${secret}`, `openhut://join#ws_Abc-123.${secret}`,
    `https://openhut.dev/join#ws_Abc-123.${secret}A`, `https://openhut.dev/join#ws.${secret}`,
    `https://openhut.dev/join#ws_Abc-123.${secret}\nsomething else`, `see https://openhut.dev/join#ws_Abc-123.${secret}`,
    `https://openhut.dev/join#ws_Abc/123.${secret}`, `https://openhut.dev/join#ws_Abc-123.${'A'.repeat(42)}=`,
  ]) assert.equal(inviteLink(text), null, String(text))
})
