import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountStepOf, lastSeenOf, Offline, screenOf } from '../../src/lib/web-first-run.ts'

const listed = { home: 'w1', workspaces: [{ id: 'w1', object: 'workspace' as const, role: 'owner' as const, access: 'listed' as const, kind: 'viewer' as const, version: 2 }] }
test('a new account goes straight to starting Cloud, with no chooser and nothing of anyone’s', () => {
  assert.deepEqual(accountStepOf({ home: 'w1', workspaces: [] }), { step: 'first-run' })
  assert.equal(screenOf({ step: 'first-run', opened: false, error: null }), 'start-cloud')
})

test('an account whose only computer is offline sees Your computer is offline, not the first-run screen', () => {
  assert.deepEqual(accountStepOf(listed), { step: 'ready', workspace: 'w1' })
  const offline = new Offline({ computer: 'Mo’s MacBook Air', seen: Date.now() - 7_200_000 })
  assert.equal(screenOf({ step: 'ready', opened: false, error: offline }), 'offline')
  assert.equal(screenOf({ step: 'ready', opened: false, error: new Error('handshake') }), 'connecting')
  assert.equal(lastSeenOf('offline 1764000000000'), 1764000000000)
  assert.equal(lastSeenOf('offline 0'), null)
  assert.equal(lastSeenOf(undefined), null)
})

test('an account with a computer this browser isn’t on yet knocks', () => {
  assert.deepEqual(accountStepOf({ ...listed, workspaces: [{ ...listed.workspaces[0], access: 'waiting' as const }] }), { step: 'knock', workspace: 'w1' })
  assert.equal(screenOf({ step: 'waiting', opened: false, error: null }), 'knock')
})

test('an invited teammate with nothing installed knocks on the team that invited them, then opens it; their own empty account is never the page', () => {
  const team = { ...listed.workspaces[0], id: 't1', role: 'member' as const }
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [] }, 't1'), { step: 'knock', workspace: 't1' })
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [team] }, 't1'), { step: 'ready', workspace: 't1' })
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [team] }), { step: 'ready', workspace: 't1' })
})
