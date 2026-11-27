import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ago, initialsOf, lastSeenOf } from '../../src/lib/format.ts'

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

test('the sidebar says when an agent was last heard from like a chat list', () => {
  const now = new Date(2026, 10, 27, 15, 0)
  assert.equal(lastSeenOf({ at: new Date(2026, 10, 27, 14, 58).toISOString(), now }), '2m')
  assert.equal(lastSeenOf({ at: new Date(2026, 10, 26, 23, 0).toISOString(), now }), 'Yesterday')
  assert.equal(lastSeenOf({ at: new Date(2026, 10, 24, 9, 0).toISOString(), now }), 'Tue')
  assert.equal(lastSeenOf({ at: new Date(2026, 10, 3, 9, 0).toISOString(), now }), 'Nov 3')
})

test('ages count weeks after a week and months after thirty days', () => {
  const now = Date.parse('2026-11-27T12:00:00Z')
  const back = (days: number) => new Date(now - days * 86_400_000).toISOString()
  assert.deepEqual([back(3), back(7), back(20), back(30), back(65)].map((at) => ago(at, now)), ['3d', '1w', '2w', '1mo', '2mo'])
})
