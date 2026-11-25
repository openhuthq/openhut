import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caddyfile, checkAddress } from '../../../src/server/platform/address.ts'

test('before an address is set, Caddy serves plain HTTP on :80 only; after, the address with its own certificate', () => {
  assert.match(caddyfile(undefined), /auto_https off[\s\S]*:80 \{\n\treverse_proxy 127\.0\.0\.1:\d+\n\}/)
  assert.equal(caddyfile('https://agents.example.com').split('\n')[0], 'agents.example.com {')
  assert.doesNotMatch(caddyfile('https://agents.example.com'), /auto_https|:80/)
})

test('the address must be an HTTPS domain, kept as its origin', () => {
  assert.equal(checkAddress('https://Agents.Example.com/setup?x=1'), 'https://agents.example.com')
  for (const bad of ['http://agents.example.com', 'https://agents.example.com:8443', 'https://10.0.0.4', 'https://localhost', 'agents.example.com', 'https://a.example.com {\n}']) assert.throws(() => checkAddress(bad), { status: 400 }, bad)
})
