import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fanOut } from '../src/mcp-fan-out.mjs'

const COMPUTERS = [{ id: 'local', name: 'This Mac', online: true }, { id: 'c1', name: 'hermes-agents', online: true }]

function harness() {
  const seen: { computer: string; msg: { params?: { arguments?: object } } }[] = []
  const mcp = fanOut({
    local: 'local',
    computers: async () => COMPUTERS,
    post: async ({ computer, msg }: { computer: string; msg: { id?: number; method: string } }) => {
      seen.push({ computer, msg })
      if (msg.id === undefined) return new Response(null, { status: 202 })
      if (msg.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'list_agents', inputSchema: { type: 'object', properties: {} } }] } })
      return Response.json({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: computer }] } })
    },
  })
  return { mcp: (msg: object) => mcp(JSON.stringify(msg)), seen }
}

test('one MCP lists the tools once, each with a computer, and runs each call on the computer it names', async () => {
  const { mcp, seen } = harness()
  const list = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.deepEqual(list.result.tools.map((tool: { name: string }) => tool.name), ['list_computers', 'list_agents'])
  assert.equal(list.result.tools[1].inputSchema.properties.computer.type, 'string')

  const computers = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_computers' } })
  assert.deepEqual(JSON.parse(computers.result.content[0].text), COMPUTERS)

  await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: { computer: 'Hermes-Agents', status: 'running' } } })
  assert.equal(seen.at(-1)?.computer, 'c1')
  assert.deepEqual(seen.at(-1)?.msg.params?.arguments, { status: 'running' })

  await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_agents' } })
  assert.equal(seen.at(-1)?.computer, 'local')

  const unknown = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_agents', arguments: { computer: 'nope' } } })
  assert.equal(unknown.result.isError, true)
  assert.match(unknown.result.content[0].text, /no computer called nope/)

  assert.equal(await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
})

test('a computer that fails answers as a JSON-RPC error with its message', async () => {
  const mcp = fanOut({ local: 'gone', computers: async () => [], post: async () => Response.json({ error: { message: 'That computer is offline.' } }, { status: 502 }) })
  assert.deepEqual(await mcp(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize' })), { jsonrpc: '2.0', id: 9, error: { code: -32603, message: 'That computer is offline.' } })
  assert.deepEqual(await mcp('{'), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'OpenHut couldn\'t read that message as JSON.' } })
})
