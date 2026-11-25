import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDERS } from '../../src/models/provider.ts'

test('OpenHut is managed, so the API key list never offers it', () => {
  assert.deepEqual(PROVIDERS.filter((info) => info.kind === 'key').map((info) => info.id), ['openrouter', 'openai', 'compatible'])
})
