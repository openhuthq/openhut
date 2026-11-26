import * as z from 'zod'
import { CONNECTION_TITLES, ConnectionKind, type CreateConnection } from '@openhut/common/connections/connection.ts'
import { defineAsk, definePlugin, defineTool } from '../../core/plugin.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { permissions } from '../../server/permissions/permissions.ts'
import { db } from '../../server/platform/db.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import type { Caller } from '../../server/team/identity.ts'
import { connectionService, type AgentTool } from '../../server/connections/connection-service.ts'
import { connectionAuthorizationController, connectionController, connectionEventController, connectionToolController } from '../../server/connections/connection-controller.ts'
import { grantController } from '../../server/agents/agent-controller.ts'
import { permissionController } from '../../server/permissions/permission-controller.ts'
import { createTables } from './tables.ts'

const STATE = z.enum(['allow', 'ask', 'deny'])
const PERMISSIONS = z.object({ read: STATE.optional(), create: STATE.optional(), update: STATE.optional(), delete: STATE.optional(), other: STATE.optional() })

const ConnectApp = z.object({
  app: z.enum(ConnectionKind.options),
  url: z.url({ protocol: /^https?$/ }).max(500).optional().describe('For app mcp: the official remote MCP server, like https://mcp.digitalocean.com/mcp.'),
  name: z.string().min(1).max(60).optional().describe('For app mcp: what the app is called, like DigitalOcean.'),
  token: z.string().min(1).max(60).optional().describe('For app mcp without a sign-in: what the token is called, like DigitalOcean token.'),
  guide: z.string().min(1).max(300).optional().describe('For a token: one or two plain sentences, where to make it and what access to give.'),
  link: z.url({ protocol: /^https$/ }).max(500).optional().describe('For a token: the page where they make it.'),
  permissions: PERMISSIONS.optional().describe('What you suggest it may do on its own for each kind of tool. Usually read allow, create and update ask, delete deny.'),
}).refine((input) => input.app === 'mcp' || (input.url ?? input.name ?? input.token) === undefined, 'Only app mcp takes a url, a name or a token.')
  .refine((input) => input.app !== 'mcp' || input.url !== undefined, 'Send the MCP server\'s url with app mcp.')

export const connections = definePlugin({
  name: 'connections',
  migrate: createTables,
  routes: () => ({
    '/api/grants': grantController,
    '/api/connections': connectionController,
    '/api/connection-events': connectionEventController,
    '/api/connection-tools': connectionToolController,
    '/api/agent-tools': permissionController,
    '/api/connection-authorizations': connectionAuthorizationController,
  }),
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
  asks: {
    connect_app: defineAsk({
      input: ConnectApp,
      answer: z.object({
        connectionId: z.string().max(40).optional(),
        fields: z.record(z.string(), z.string().max(4000)).optional(),
        permissions: PERMISSIONS.optional(),
      }).refine((answer) => answer.connectionId !== undefined || answer.fields !== undefined, 'Pick a connection or fill in its fields.'),
      tool: 'Ask your owner to connect an app you need and can\'t reach yet: one call per app, all in the same turn, then stop. They connect it in OpenHut (sign in, a key or a connection they already have) and you get access with the permissions they pick; you never see a key. For an app with an official remote MCP server, send app mcp with its url, name and the token\'s label and guide. The answer comes back as a message. If they decline and chose the browser, do this one job in your browser and don\'t keep the login; if they\'ll set it up themselves, give them short numbered steps.',
      title: ({ input }) => `Connect ${appName(input)}`,
      run: async ({ actor, ask: { agentId, input }, answer }) => {
        const connection = answer.connectionId ? await connectionService.get({ actor, id: answer.connectionId }) : await connectionService.create({ actor, ...keyed({ input, fields: answer.fields ?? {} }) })
        if (connection.kind !== input.app) throw new HttpError(400, `${connection.name} isn't a ${CONNECTION_TITLES[input.app]} connection.`)
        const specs = answer.permissions ? await connectionService.specs({ actor, connectionId: connection.id }).catch(() => []) : []
        for (const [group, state] of Object.entries(answer.permissions ?? {})) {
          const tools = specs.filter((spec) => permissions.groupOf(spec) === group).map((spec) => spec.name)
          if (tools.length) await permissions.set({ actor, agentId, connectionId: connection.id, tools, state })
        }
        await agentService.createGrant({ actor, agentId, connectionId: connection.id })
        return `You can use ${connection.name} now (${connection.id}). Call list_tools to see its tools.`
      },
    }),
    call_tool: defineAsk({
      input: z.object({
        connectionId: z.string().max(40), tool: z.string().max(200), name: z.string().max(200), arguments: z.record(z.string(), z.unknown()),
        action: z.object({ name: z.string().max(200), label: z.string().max(200) }).optional(), always: z.boolean().optional(),
      }),
      answer: z.object({ always: z.boolean().optional() }),
      title: async ({ input }) => {
        const connection = await db.selectFrom('connection').select('name').where('id', '=', input.connectionId).executeTakeFirstOrThrow()
        return input.action ? `${connection.name}: ${input.action.label}` : `Run ${input.tool} on ${connection.name}`
      },
      run: async ({ actor, ask: { agentId, input, why }, answer }) => {
        if (answer.always) await permissions.set({ actor, agentId, connectionId: input.connectionId, tools: [input.action?.name ?? input.tool], state: 'allow' })
        const result = await connectionService.callApproved({ actor, agentId, connectionId: input.connectionId, tool: input.tool, args: input.arguments, reason: why })
        return `${answer.always ? 'From now on it runs without asking. ' : ''}The result:\n\n${result.text}`
      },
      declined: async ({ actor, ask: { agentId, input, why } }) => {
        await db.insertInto('connection_event').values({ agent_id: agentId, connection_id: input.connectionId, tool: input.name, reason: why.slice(0, 500), outcome: 'denied', ms: 0, approved_by: actor.id }).execute()
      },
    }),
  },
})

function appName(input: z.infer<typeof ConnectApp>): string {
  return input.name ?? CONNECTION_TITLES[input.app]
}

function keyed({ input, fields }: { input: z.infer<typeof ConnectApp>; fields: Record<string, string> }): CreateConnection {
  const name = appName(input)
  if (input.app === 'mcp') {
    const token = fields.token?.trim()
    if (token !== undefined && (!token || /\s/.test(token))) throw new HttpError(400, `Paste the ${input.token ?? 'token'} as it is, with no spaces.`, { param: 'token' })
    return { kind: 'mcp', name, url: input.url, header: token ? `Authorization: Bearer ${token}` : fields.header }
  }
  if (input.app === 'postgres') return { kind: 'postgres', name, dsn: fields.dsn }
  if (input.app === 'convex') return { kind: 'convex', name, deployKey: fields.deployKey }
  if (input.app === 'excalidraw') return { kind: 'excalidraw', name }
  throw new HttpError(400, `${CONNECTION_TITLES[input.app]} connects by signing in, not with fields.`)
}

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
