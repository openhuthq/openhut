import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { serveMcp } from '../../../../src/server/platform/mcp-transport.ts'

export const ACTIONS = [
  { name: 'databases/db-cluster-list', description: 'List the database clusters.', annotations: { title: 'List databases', readOnlyHint: true } },
  { name: 'databases/db-cluster-resize', description: 'Resize a database cluster.', annotations: { title: 'Resize a database', readOnlyHint: false, destructiveHint: false } },
  { name: 'databases/db-cluster-delete', description: 'Delete a database cluster.', annotations: { title: 'Delete a database', destructiveHint: true } },
  { name: 'apps/app-mystery', description: 'Does something.' },
  { name: 'insights/insights-alert-rule-list', description: 'List the alert rules.' },
  { name: 'databases/db-cluster-create', description: 'Create a database cluster.', inputSchema: { type: 'object', properties: { Region: { type: 'string' }, Label: { type: 'string' } }, required: ['Region', 'Label'] } },
]

export type FakeDigitalOcean = { url: string; invoked: string[]; lookups: string[]; close: () => void }

export async function fakeDigitalOcean(): Promise<FakeDigitalOcean | undefined> {
  const host = Object.values(networkInterfaces()).flat().find((each) => each?.family === 'IPv4' && !each.internal)?.address
  if (!host) return undefined
  const invoked: string[] = []
  const lookups: string[] = []
  const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const mcp = () => {
    const server = new McpServer({ name: 'fake-digitalocean', version: '1' })
    server.registerTool('mcp_find_tools', { description: 'Find tools.', inputSchema: { query: z.string(), limit: z.number().optional() }, annotations: { readOnlyHint: true } }, async ({ query }) => {
      lookups.push(`find ${query}`)
      return text({ tools: ACTIONS.filter((each) => each.name.includes(query) || each.description.toLowerCase().includes(query.toLowerCase())).map(({ inputSchema: _, ...each }) => each) })
    })
    server.registerTool('mcp_retrieve_schema', { description: 'Get a tool\'s schema.', inputSchema: { name: z.string() }, annotations: { readOnlyHint: true } }, async ({ name }) => {
      lookups.push(`schema ${name}`)
      return text({ name, inputSchema: ACTIONS.find((each) => each.name === name)?.inputSchema ?? { type: 'object', properties: {} } })
    })
    server.registerTool('mcp_invoke_tool', { description: 'Invoke a DigitalOcean tool.', inputSchema: { name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }, annotations: { readOnlyHint: false, destructiveHint: true } }, async ({ name }) => {
      invoked.push(name)
      return text({ ran: name })
    })
    return server
  }
  const http: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    await serveMcp({ server: mcp(), req, res, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined })
  }).listen(0, '0.0.0.0')
  await new Promise((resolve) => http.once('listening', resolve))
  return { url: `http://${host}:${(http.address() as AddressInfo).port}/mcp`, invoked, lookups, close: () => http.close() }
}
