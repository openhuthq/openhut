import * as z from 'zod'
import { definePlugin, defineTool } from '../../core/plugin.ts'
import { connectionService, type AgentTool } from '../../server/connections/connection-service.ts'

export const connections = definePlugin({
  name: 'connections',
  hermes: ({ connections: list }) => ({ prompt: connectedApps(list) }),
  tools: {
    list_tools: defineTool({
      description: 'List the tools you may call, one line each.',
      input: { app: z.string().max(40).optional() },
      run: async ({ app }, { agent }) => toolList({ granted: await connectionService.tools({ agent }), app }),
    }),
    describe_tool: defineTool({
      description: 'Show the input schema of one or more tools.',
      input: { names: z.array(z.string().max(100)).min(1).max(20) },
      run: async ({ names }, { agent }) => {
        const byName = new Map((await connectionService.tools({ agent })).map((each) => [each.name, each.spec]))
        return JSON.stringify(names.map((name) => ({ name, schema: byName.get(name)?.schema ?? null, description: byName.get(name)?.description ?? 'Not available to this agent' })))
      },
    }),
    call_tool: defineTool({
      description: 'Run a tool from list_tools. Some tools wait for your owner\'s OK: then the call returns at once, and the result comes back to you as a message.',
      input: {
        reason: z.string().min(1).max(500).describe('Why you need this, in a few words. Shown in the audit.'),
        name: z.string().max(100),
        arguments: z.record(z.string(), z.unknown()).default({}),
        connectionId: z.string().max(100).optional(),
      },
      run: ({ reason, name, arguments: args, connectionId }, { agent, origin }) => connectionService.call({ agent, name, args, connectionId, reason, origin }),
    }),
  },
})

export function toolList({ granted, app }: { granted: AgentTool[]; app: string | undefined }): string {
  const wanted = app?.trim().toLowerCase()
  const tools = granted.filter((tool) => !wanted || tool.connection.kind === wanted || tool.connection.name.toLowerCase() === wanted)
  const lines = tools.map((tool) => `${tool.name} [${tool.connection.name}, ${tool.connection.id}]: ${tool.spec.description}`.slice(0, 140))
  if (lines.length) return lines.slice(0, 100).join('\n')
  return granted.length ? `No app named ${app}. Leave app out to list every tool.` : 'No tools: nobody has granted this agent a connection yet.'
}

function connectedApps(list: { name: string; kind: string }[]): string {
  if (!list.length) return ''
  const apps = list.map(({ name, kind }) => {
    const plain = name.replace(/\s+/g, ' ').trim()
    return plain.toLowerCase() === kind ? plain : `${plain} (${kind})`
  })
  return `## Connected apps\n\nThe openhut tools reach: ${apps.join(', ')}. Call list_tools to see what each one does, and use it before doing the same work by hand.`
}
