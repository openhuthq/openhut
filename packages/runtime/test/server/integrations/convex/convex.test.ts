import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convex } from '../../../../src/server/integrations/convex/convex.ts'

test('Convex runs its official MCP server over stdio, with the env-var tools off', async () => {
  const names = (await convex.connector.tools({ config: { deployKey: 'dev:happy-otter-123|eyJfake' }, refresh: async () => ({}) })).map((tool) => tool.name)
  for (const name of ['tables', 'data', 'functionSpec', 'run', 'logs']) assert.ok(names.includes(name), `${name} is missing from ${names.join(', ')}`)
  for (const name of ['envList', 'envGet', 'envSet', 'envRemove']) assert.ok(!names.includes(name), `${name} should be off`)
})

test('a deploy key that is not shaped like one is refused before anything runs', async () => {
  await assert.rejects(convex.probe('not-a-key'), /Paste a deploy key/)
})
