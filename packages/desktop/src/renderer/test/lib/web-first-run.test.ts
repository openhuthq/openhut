import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountStepOf, lastSeenOf, Offline, phoneBrowser, savedOf, screenOf } from '../../src/lib/web-first-run.ts'

const listed = { home: 'w1', workspaces: [{ id: 'w1', object: 'workspace' as const, role: 'owner' as const, access: 'listed' as const, kind: 'viewer' as const, version: 2 }] }
const desk = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0 Safari/537.36', width: 1280 }
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', width: 390 }

test('signing in on the web with no computer shows the first-run choice, and it carries nothing of yours: only the email it greets you with', () => {
  assert.equal(accountStepOf({ home: 'w1', workspaces: [] }), 'first-run')
  assert.equal(screenOf({ step: 'first-run', opened: false, error: null, phone: false }), 'first-run')
})

test('an account whose only computer is offline sees Your computer is offline, not the first-run screen', () => {
  assert.equal(accountStepOf(listed), 'ready')
  const offline = new Offline({ computer: 'Mo’s MacBook Air', seen: Date.now() - 7_200_000 })
  assert.equal(screenOf({ step: 'ready', opened: false, error: offline, phone: false }), 'offline')
  assert.equal(screenOf({ step: 'ready', opened: false, error: offline, phone: true }), 'offline')
  assert.equal(screenOf({ step: 'ready', opened: false, error: new Error('handshake'), phone: false }), 'connecting')
  assert.equal(lastSeenOf('offline 1764000000000'), 1764000000000)
  assert.equal(lastSeenOf('offline 0'), null)
  assert.equal(lastSeenOf(undefined), null)
})

test('an account with a computer this browser isn’t on yet knocks', () => {
  assert.equal(accountStepOf({ ...listed, workspaces: [{ ...listed.workspaces[0], access: 'waiting' as const }] }), 'knock')
  assert.equal(screenOf({ step: 'waiting', opened: false, error: null, phone: false }), 'knock')
})

test('on a phone the first run offers to send the link to a computer', () => {
  assert.equal(phoneBrowser(iphone), true)
  assert.equal(phoneBrowser(desk), false)
  assert.equal(screenOf({ step: 'first-run', opened: false, error: null, phone: true }), 'phone')
})

test('closing the tab and coming back resumes at the same step, and junk in storage starts over', () => {
  assert.deepEqual(savedOf(JSON.stringify({ step: 'mac' })), { step: 'mac' })
  assert.deepEqual(savedOf(JSON.stringify({ step: 'server', code: 'abc', expiresAt: '2026-11-24T10:10:00Z' })), { step: 'server', code: 'abc', expiresAt: '2026-11-24T10:10:00Z' })
  assert.deepEqual(savedOf(JSON.stringify({ step: 'server' })), { step: 'server' })
  assert.equal(savedOf('{nope'), null)
  assert.equal(savedOf(JSON.stringify({ step: 'cloud' })), null)
  assert.equal(savedOf(null), null)
})
