import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checksKit, gateOf, migrating } from '../../src/app/gate-state.ts'

const kit = { savedAt: '2026-11-23T10:00:00Z', differs: false }
const on = { status: 'on' as const, kit, kitInCloud: true, youngUntil: null }
const fresh = { fresh: true, done: false, failed: false }
const ready = { fresh: true, done: true, failed: false }

test('signed out is the sign-in screen, locked is Unlock, no kit is the kit, and a kit lets you in', () => {
  assert.equal(gateOf({ cloud: { ...on, status: 'off', kit: null }, setup: undefined, down: false }), 'sign-in')
  assert.equal(gateOf({ cloud: { ...on, status: 'locked', kit: null }, setup: undefined, down: false }), 'unlock')
  assert.equal(gateOf({ cloud: { ...on, kit: null, kitInCloud: false }, setup: undefined, down: false }), 'kit')
  assert.equal(gateOf({ cloud: { ...on, kit: null }, setup: undefined, down: false }), 'ready', 'a kit already in the cloud is never overwritten from here')
  assert.equal(gateOf({ cloud: on, setup: undefined, down: false }), 'ready')
  assert.equal(gateOf({ cloud: { ...on, status: 'offline' }, setup: undefined, down: false }), 'ready')
})

test('a computer added less than 3 days ago, which can’t make a kit yet, is let in without one', () => {
  assert.equal(gateOf({ cloud: { ...on, kit: null, youngUntil: '2026-11-25T10:00:00Z' }, setup: undefined, down: false }), 'ready')
})

test('a fresh install signs in while OpenHut starts, then shows Getting ready until the first run is done', () => {
  assert.equal(gateOf({ cloud: undefined, setup: fresh, down: false }), 'sign-in')
  assert.equal(gateOf({ cloud: { ...on, status: 'off', kit: null }, setup: fresh, down: false }), 'sign-in')
  assert.equal(gateOf({ cloud: { ...on, kit: null, kitInCloud: false }, setup: fresh, down: false }), 'kit')
  assert.equal(gateOf({ cloud: on, setup: fresh, down: false }), 'getting-ready')
  assert.equal(gateOf({ cloud: on, setup: ready, down: false }), 'ready')
})

test('a fresh install whose runtime isn’t answering yet, or whose first run failed, shows Getting ready', () => {
  assert.equal(gateOf({ cloud: undefined, setup: fresh, down: true }), 'getting-ready')
  assert.equal(gateOf({ cloud: undefined, setup: { ...fresh, failed: true }, down: false }), 'getting-ready')
})

test('an install that isn’t fresh waits for the runtime, and the error screen shows when it’s down', () => {
  assert.equal(gateOf({ cloud: undefined, setup: undefined, down: false }), 'loading')
  assert.equal(gateOf({ cloud: undefined, setup: { fresh: false, done: true, failed: false }, down: true }), 'loading')
})

test('an install with agents and no account is told its agents come along, unless it opened an invite', () => {
  assert.equal(migrating({ agents: 0, invited: false }), undefined)
  assert.equal(migrating({ agents: 1, invited: false }), 'Your agent comes with you, end-to-end encrypted.')
  assert.equal(migrating({ agents: 3, invited: false }), 'Your 3 agents come with you, end-to-end encrypted.')
  assert.equal(migrating({ agents: 3, invited: true }), undefined)
})

test('a saved or copied kit counts as saved right away; only writing the words down asks for two of them back', () => {
  assert.equal(checksKit('file'), false)
  assert.equal(checksKit('copy'), false)
  assert.equal(checksKit('words'), true)
})
