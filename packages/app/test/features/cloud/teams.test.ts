import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inWorkspace } from '../../../src/features/cloud/teams.ts'

const home = { id: 'sara', home: true }
const team = { id: 'mo', home: false }

test('your own workspace shows agents of no team and agents on other computers; a team shows only its own', () => {
  assert.equal(inWorkspace({ agent: { computer: 'local', workspace: null }, active: home }), true)
  assert.equal(inWorkspace({ agent: { computer: 'local', workspace: 'sara' }, active: home }), true)
  assert.equal(inWorkspace({ agent: { computer: 'server', workspace: null }, active: home }), true)
  assert.equal(inWorkspace({ agent: { computer: 'local', workspace: 'mo' }, active: home }), false)
  assert.equal(inWorkspace({ agent: { computer: 'local', workspace: 'mo' }, active: team }), true)
  assert.equal(inWorkspace({ agent: { computer: 'local', workspace: null }, active: team }), false)
  assert.equal(inWorkspace({ agent: { computer: 'server', workspace: null }, active: team }), false)
})

test('a team\'s agent on a teammate\'s computer shows in that team, not in your own workspace', () => {
  assert.equal(inWorkspace({ agent: { computer: 'mo-mac', workspace: 'mo' }, active: team }), true)
  assert.equal(inWorkspace({ agent: { computer: 'mo-mac', workspace: 'mo' }, active: home }), false)
})
