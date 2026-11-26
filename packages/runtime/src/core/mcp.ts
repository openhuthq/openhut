import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import { config } from '../server/platform/config.ts'
import type { ToolResult } from './plugin.ts'
import { plugins } from './plugins.ts'

export function mcpOf(agent: GatewayAgent): McpServer {
  const server = new McpServer({ name: 'openhut', version: config.version })
  for (const plugin of plugins()) {
    for (const [name, tool] of Object.entries(plugin.tools ?? {})) {
      if (tool.local) continue
      server.registerTool(name, { description: tool.description, inputSchema: z.object(tool.input).passthrough() }, async ({ origin, ...input }: Record<string, unknown>) => contentOf(await tool.run(input, { agent, origin })))
    }
  }
  return server
}

function contentOf(result: ToolResult) {
  if (typeof result !== 'string' && 'send' in result) return { content: [{ type: 'text' as const, text: 'Only a local tool can send a message.' }], isError: true }
  const { text, isError } = typeof result === 'string' ? { text: result, isError: false } : result
  return { content: [{ type: 'text' as const, text }], isError }
}
