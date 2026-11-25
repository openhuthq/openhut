import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateOf } from '../../src/app/gate-state.ts'

test('no answer yet waits, signed out is the sign-in screen, and signed in lets you in', () => {
  assert.equal(gateOf(undefined), 'loading')
  assert.equal(gateOf({ status: 'off' }), 'sign-in')
  assert.equal(gateOf({ status: 'on' }), 'ready')
  assert.equal(gateOf({ status: 'offline' }), 'ready')
})
