import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountStepOf, lastSeenOf, Offline, screenOf } from '../../src/lib/web-first-run.ts'

const listed = { home: 'w1', unstarted: [], workspaces: [{ id: 'w1', object: 'workspace' as const, name: 'Mo’s team', people: 1, role: 'owner' as const, access: 'listed' as const, kind: 'viewer' as const, version: 2 }] }
test('a new account opens the App straight away, with no computer yet and nothing of anyone’s', () => {
  assert.deepEqual(accountStepOf({ home: 'w1', workspaces: [], unstarted: [] }), { step: 'first-run', workspace: 'w1' })
  assert.equal(screenOf({ step: 'first-run', opened: false, error: null }), 'open')
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

test('an invited teammate with nothing installed sees the Join card for the team that invited them, then opens it; their own empty account is never the page', () => {
  const team = { ...listed.workspaces[0], id: 't1', role: 'member' as const }
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [], unstarted: [] }, { invited: 't1' }), { step: 'invited', workspace: 't1' })
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [team], unstarted: [] }, { invited: 't1' }), { step: 'ready', workspace: 't1' })
  assert.deepEqual(accountStepOf({ home: 'w9', workspaces: [team], unstarted: [] }), { step: 'ready', workspace: 't1' })
})

test('the team picked in the account menu opens; one made but not started yet starts its own Cloud', () => {
  const side = { id: 's1', object: 'workspace' as const, name: 'Side project' }
  assert.deepEqual(accountStepOf({ ...listed, unstarted: [side] }, { chosen: 's1' }), { step: 'first-run', workspace: 's1' })
  assert.deepEqual(accountStepOf({ ...listed, workspaces: [...listed.workspaces, { ...listed.workspaces[0], id: 's1' }] }, { chosen: 's1' }), { step: 'ready', workspace: 's1' })
  assert.deepEqual(accountStepOf({ ...listed, workspaces: [...listed.workspaces, { ...listed.workspaces[0], id: 's1', access: 'waiting' as const }] }, { chosen: 's1' }), { step: 'knock', workspace: 's1' }, 'its Cloud computer is up: this browser asks in')
  assert.deepEqual(accountStepOf(listed, { chosen: 'gone' }), { step: 'ready', workspace: 'w1' })
})
