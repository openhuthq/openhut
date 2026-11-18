import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wordsOf } from '../../../src/features/settings/command-words.ts'

test('a command wraps only between its arguments, keeping a quoted path and a flag with its value whole', () => {
  assert.deepEqual(wordsOf('claude mcp add openhut-box -- "~/Library/Application Support/OpenHut Dev/bin/openhut-mcp" --computer c1'),
    ['claude', 'mcp', 'add', 'openhut-box', '--', '"~/Library/Application Support/OpenHut Dev/bin/openhut-mcp"', '--computer c1'])
  assert.deepEqual(wordsOf('/opt/openhut/bin/openhut-mcp'), ['/opt/openhut/bin/openhut-mcp'])
})
