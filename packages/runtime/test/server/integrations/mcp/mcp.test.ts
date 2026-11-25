import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcp } from '../../../../src/server/integrations/mcp/mcp.ts'

const SERVER = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
const server = new McpServer({ name: 'fake', version: '1' })
for (const name of ['create_view', 'export_to_excalidraw']) server.registerTool(name, { description: name }, async () => ({ content: [{ type: 'text', text: name + ' ran' }] }))
await server.connect(new StdioServerTransport())
`

test('a hidden tool is neither listed nor callable', async () => {
  const connector = mcp.connector({ stdio: () => ({ command: process.execPath, args: ['--input-type=module', '-e', SERVER], cwd: process.cwd() }), redirectUrl: () => '', hide: ['create_view'] })
  const ctx = { config: {}, refresh: async () => ({}) }
  assert.deepEqual((await connector.tools(ctx)).map((tool) => tool.name), ['export_to_excalidraw'])
  assert.equal((await connector.call({ ...ctx, tool: 'create_view', args: {} })).isError, true)
  assert.deepEqual(await connector.call({ ...ctx, tool: 'export_to_excalidraw', args: {} }), { text: 'export_to_excalidraw ran', isError: false })
})
