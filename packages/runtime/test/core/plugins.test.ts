import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checked, plugins } from '../../src/core/plugins.ts'
import { definePlugin, defineTool } from '../../src/core/plugin.ts'

test('two plugins with the same tool name fail at boot', () => {
  const ping = defineTool({ description: 'Ping.', input: {}, run: async () => 'pong' })
  assert.throws(() => checked([definePlugin({ name: 'a', tools: { ping } }), definePlugin({ name: 'b', tools: { ping } })]), /Two plugins define the tool ping/)
})

test('every openhut tool comes from exactly one plugin', () => {
  const names = plugins().flatMap((plugin) => Object.keys(plugin.tools ?? {}))
  assert.equal(new Set(names).size, names.length)
  assert.equal(names.length, 17)
})
