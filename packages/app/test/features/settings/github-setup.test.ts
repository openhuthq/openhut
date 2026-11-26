import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appName, connectStep, ownerSuggestions, rememberOwner, setupStage, slugOf } from '../../../src/features/settings/github-setup.ts'

test('the setup dialog moves on by itself: form, creating on GitHub, installing, done once a repository is reachable', () => {
  assert.equal(setupStage({ started: false, app: null }), 'form')
  assert.equal(setupStage({ started: true, app: null }), 'creating')
  assert.equal(setupStage({ started: true, app: { repositories: null } }), 'installing')
  assert.equal(setupStage({ started: true, app: { repositories: 0 } }), 'installing')
  assert.equal(setupStage({ started: true, app: { repositories: 3 } }), 'done')
})

test('the app name is filled in from the owner, else from the server\'s address', () => {
  assert.equal(appName({ owner: 'Acme', host: 'openhut.example.com' }), 'acme-openhut')
  assert.equal(appName({ owner: '', host: 'openhut.acme.dev' }), 'acme-openhut')
  assert.equal(appName({ owner: ' ', host: '127.0.0.1' }), 'team-openhut')
  assert.equal(slugOf('Acme OpenHut'), 'acme-openhut')
})

test('the owner list suggests owners used before, then their public organizations, once each', () => {
  const orgs = [{ login: 'acme', avatarUrl: 'a', org: true }, { login: 'Mo', avatarUrl: 'm', org: true }]
  assert.deepEqual(ownerSuggestions({ remembered: ['mo', 'acme-labs'], orgs }).map((each) => [each.login, each.org]), [['mo', true], ['acme-labs', false], ['acme', true]])
  assert.deepEqual(ownerSuggestions({ remembered: [], orgs: [] }), [])
})

test('remembering an owner puts it first, once, and keeps the last five', () => {
  assert.deepEqual(rememberOwner({ owners: ['a', 'B', 'c'], owner: ' b ' }), ['b', 'a', 'c'])
  assert.deepEqual(rememberOwner({ owners: ['a'], owner: '  ' }), ['a'])
  assert.deepEqual(rememberOwner({ owners: ['1', '2', '3', '4', '5'], owner: '6' }), ['6', '1', '2', '3', '4'])
})

test('Connect on GitHub with no app sets it up first for an admin, then connects in the same dialog; a member asks an admin, never an error', () => {
  assert.equal(connectStep({ admin: true, app: false, started: false, ready: false }), 'setup')
  assert.equal(connectStep({ admin: true, app: true, started: true, ready: false }), 'setup')
  assert.equal(connectStep({ admin: true, app: true, started: true, ready: true }), 'connect')
  assert.equal(connectStep({ admin: true, app: true, started: false, ready: false }), 'connect')
  assert.equal(connectStep({ admin: false, app: false, started: false, ready: false }), 'ask')
  assert.equal(connectStep({ admin: false, app: true, started: false, ready: false }), 'connect')
})
