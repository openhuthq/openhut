import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appName, setupStage, slugOf } from '../../../src/features/settings/github-setup.ts'

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
