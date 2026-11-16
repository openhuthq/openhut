import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolList } from '../../src/gateway/gateway-server.ts'

const granted = [{ name: 'excalidraw_draw', connection: { id: 'cn_abcd1234', kind: 'excalidraw' as const, name: 'Excalidraw' }, spec: { name: 'draw', description: 'Draw a diagram.', schema: {} } }]

test('list_tools finds an app by its kind or its name, whatever the capitals', () => {
  for (const app of [undefined, 'excalidraw', 'Excalidraw', ' EXCALIDRAW ']) assert.match(toolList({ granted, app }), /^excalidraw_draw \[Excalidraw, cn_abcd1234\]: Draw a diagram\.$/)
})

test('an unknown app is told apart from having no connection at all', () => {
  assert.equal(toolList({ granted, app: 'linear' }), 'No app named linear. Leave app out to list every tool.')
  assert.equal(toolList({ granted: [], app: 'linear' }), 'No tools: nobody has granted this agent a connection yet.')
})
