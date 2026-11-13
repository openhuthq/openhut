import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { config } from '../platform/config.ts'
import { messageOf } from '../platform/http-error.ts'
import { MCP_TOOLS, type Api } from './mcp-tools.ts'

export const mcpService = {
  server({ api }: { api: Api }): McpServer {
    const server = new McpServer({ name: 'fastmonkey', version: config.version }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { type: 'object' as const, ...inputSchema } })),
    }))
    server.server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
      const found = MCP_TOOLS.find((candidate) => candidate.name === req.params.name)
      if (!found) return failure(`There's no tool called ${req.params.name}. List the tools to see what Fast Monkey offers.`)
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await found.run({ api, args: req.params.arguments ?? {} }), null, 2) }] }
      } catch (err) {
        return failure(messageOf(err))
      }
    })
    return server
  },
}

const failure = (message: string): CallToolResult => ({ content: [{ type: 'text', text: message }], isError: true })
