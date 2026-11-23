import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkPath } from '../src/open-link.mjs'

test('an invite link opens the join screen', () => {
  assert.equal(linkPath('openhut://join#ws_abc.secret'), '/join#ws_abc.secret')
})

test('an agent\'s connect link opens only a connect sheet', () => {
  assert.equal(linkPath('openhut://open#/connections/new/postgres?for=ag_1'), '/connections/new/postgres?for=ag_1')
  assert.equal(linkPath('openhut://open#/agents/ag_1/memory?x=1'), undefined)
  assert.equal(linkPath('openhut://open#/connections/new/postgres'), undefined)
  assert.equal(linkPath('openhut://evil#/connections/new/postgres?for=ag_1'), undefined)
  assert.equal(linkPath('https://openhut.dev/open#/connections/new/postgres?for=ag_1'), undefined)
  assert.equal(linkPath('openhut://open#/connections/new/postgres?for=ag_1&error=x'), undefined)
  assert.equal(linkPath(undefined), undefined)
})
