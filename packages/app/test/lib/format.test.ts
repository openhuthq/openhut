import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialsOf } from '../../src/lib/format.ts'

test('initials take each word\'s first letter and never cut an emoji in half', () => {
  assert.equal(initialsOf({ name: 'Mo 🇵🇸' }), 'M')
  assert.equal(initialsOf({ name: '🇵🇸 Mo Ali' }), 'MA')
  assert.equal(initialsOf({ name: 'DigitalOcean Postgres alerts' }), 'DP')
  assert.equal(initialsOf({ name: 'ana.lopez@example.com', count: 1 }), 'A')
  assert.equal(initialsOf({ name: 'émile zola' }), 'ÉZ')
})

test('a name that is only an emoji, or nothing, shows a question mark', () => {
  assert.equal(initialsOf({ name: '🇵🇸' }), '?')
  assert.equal(initialsOf({ name: '🔥 🚀' }), '?')
  assert.equal(initialsOf({ name: '' }), '?')
})
