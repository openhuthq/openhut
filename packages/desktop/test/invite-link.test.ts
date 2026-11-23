import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invitePath } from '../src/invite-link.mjs'

const secret = 'A'.repeat(42) + 'Q'
const link = `https://openhut.dev/join#ws_Abc-123.${secret}`
const email = Buffer.from('ana@example.com').toString('base64url')

test('an invite link on the clipboard becomes the join screen, around its whitespace, with or without the email it was sent to', () => {
  assert.equal(invitePath(link), `/join#ws_Abc-123.${secret}`)
  assert.equal(invitePath(`  ${link}\n`), `/join#ws_Abc-123.${secret}`)
  assert.equal(invitePath(`https://openhut.dev/join#${email}#ws_Abc-123.${secret}`), `/join#${email}#ws_Abc-123.${secret}`)
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
    `https://openhut.dev/join#ws_Abc-123.${secret}.${email}`, `https://openhut.dev/join##ws_Abc-123.${secret}`, `https://openhut.dev/join#a#b#ws_Abc-123.${secret}`,
  ]) assert.equal(invitePath(text), undefined, String(text))
})
