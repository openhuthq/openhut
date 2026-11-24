import { test } from 'node:test'
import assert from 'node:assert/strict'
import { home } from '../../../src/features/settings/home.ts'

test('a home folder shows as ~, kept outside quotes so the command still works when typed', () => {
  assert.equal(home('claude mcp add openhut -- "/Users/me/Library/Application Support/OpenHut Dev/bin/openhut-mcp"'),
    'claude mcp add openhut -- ~/"Library/Application Support/OpenHut Dev/bin/openhut-mcp"')
  assert.equal(home('/Users/me/Library/Application Support/OpenHut/bin/openhut-mcp'), '~/Library/Application Support/OpenHut/bin/openhut-mcp')
  assert.equal(home('cd "/home/me"'), 'cd ~')
  assert.equal(home('sudo tailscale set --ssh'), 'sudo tailscale set --ssh')
})
