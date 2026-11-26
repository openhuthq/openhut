import * as z from 'zod'
import * as mini from 'zod/mini'
import { askCard, MCP_AUTH } from '@openhut/common/asks/ask.ts'
import { ConnectionKind, ProposedConnection } from '@openhut/common/connections/connection.ts'
import { defineAsk, definePlugin, defineTool } from '../../core/plugin.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { permissions } from '../../server/permissions/permissions.ts'
import { db } from '../../server/platform/db.ts'
import { describeIssues, HttpError } from '../../server/platform/http-error.ts'
import type { Caller } from '../../server/team/identity.ts'
import { connectionService, type AgentTool } from '../../server/connections/connection-service.ts'
import { connectionAuthorizationController, connectionController, connectionEventController, connectionToolController } from '../../server/connections/connection-controller.ts'
import { grantController } from '../../server/agents/agent-controller.ts'
import { permissionController } from '../../server/permissions/permission-controller.ts'
import { createTables } from './tables.ts'

const GROUPS = z.array(z.object({
  group: z.enum(['read', 'create', 'update', 'delete', 'other']).describe('other: tools the app doesn\'t label, and one generic tool that runs any other tool (like mcp_invoke_tool), so it can do anything.'),
  label: z.string().min(1).max(80).describe('What these tools do here, in plain words: "Read database info".'),
  permission: z.enum(['allow', 'ask', 'deny']).describe('allow runs without asking, ask waits for their OK each time, deny never runs. Usually: read allow, create and update ask, delete deny.'),
})).min(1).max(5)

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
    ask_to_connect: defineTool({
      description: 'Ask the person to connect the apps you need and can\'t reach yet, all in one card. You get the card: put it in your reply.',
      input: {
        why: z.string().min(1).max(300).describe('One or two sentences for the person: what the apps are for, and how to make the access if they need to (a read-only role, a token\'s scopes).'),
        apps: z.array(z.object({
          app: z.enum(ConnectionKind.options),
          line: z.string().min(1).max(80).optional().describe('What you\'ll do with it, a few plain words: "open tickets for the SRE team".'),
          url: z.url({ protocol: /^https$/ }).max(500).optional().describe('For app mcp: the server\'s URL.'),
          name: z.string().min(1).max(60).optional().describe('For app mcp: what to call it, like Cloudflare.'),
          auth: z.enum(MCP_AUTH).optional().describe('For app mcp: how the server lets you in. header for a token, sign_in for OAuth (Cloudflare\'s servers, like https://observability.mcp.cloudflare.com/mcp), public for none.'),
        })).min(1).max(8),
      },
      run: async ({ why, apps }, { agent }) => {
        if (apps.some(({ app, url, name, auth }) => (url || name || auth) && app !== 'mcp')) return { text: 'Only app mcp takes a url, a name or auth. Leave them out.', isError: true }
        if (apps.some(({ app, url }) => app === 'mcp' && !url)) return { text: 'Send the MCP server\'s url with app mcp.', isError: true }
        return `Put this card in your reply, after a sentence on what you need:\n\n${askCard({ asks: apps.map((each) => ({ ...each, agentId: agent.id })), why })}`
      },
    }),
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
    request_connection: defineAsk({
      input: z.object({ connectionId: z.string().max(40) }),
      tool: 'Ask for a connection that already exists in OpenHut (get_self lists them). For an app nobody connected yet, use ask_to_connect.',
      title: async ({ input }) => {
        const connection = await db.selectFrom('connection').select('name').where('id', '=', input.connectionId).executeTakeFirst()
        if (!connection) throw new HttpError(404, `There's no connection ${input.connectionId}. Call get_self to see the ones you can ask for.`)
        return `Use ${connection.name}`
      },
      run: async ({ actor, ask: { agentId, input } }) => {
        await agentService.createGrant({ actor, agentId, connectionId: input.connectionId })
        return 'You restart to pick it up right after this reply.'
      },
    }),
    propose_connection: defineAsk({
      input: z.object({
        name: z.string().min(1).max(60).describe('The app, like DigitalOcean.'),
        line: z.string().max(120).optional().describe('What it is to the person, a few plain words: "where your database runs".'),
        url: z.url({ protocol: /^https$/ }).max(500).describe('The official remote MCP server, like https://mcp.digitalocean.com/mcp.'),
        token: z.object({
          label: z.string().min(1).max(60).describe('What the token is called, like DigitalOcean token.'),
          guide: z.string().min(1).max(300).describe('One or two plain sentences: where to make it and what access to give.'),
          link: z.url({ protocol: /^https$/ }).max(500).describe('The page where they make it.'),
          scopes: z.array(z.string().max(100)).max(30).optional().describe('The scopes it needs, as the app names them.'),
        }),
        groups: GROUPS.describe('One entry per kind of tool the job needs.'),
      }),
      answer: z.object({ groups: GROUPS.optional(), key: z.string().max(4000).optional().meta({ secret: true }) }),
      tool: 'Propose connecting an app that isn\'t on ask_to_connect\'s list, through its official remote MCP server that takes a token. Your owner sees a card, makes the token with your guide and pastes it in OpenHut; you never see it. Say what each kind of tool may do. If they decline and chose the browser, do this one job in your browser and don\'t keep the login; if they\'ll set it up themselves, give them short numbered steps: where to make the token, then Apps in OpenHut to add it, then to give you access.',
      title: ({ input }) => `Connect ${proposalOf(input).name}`,
      run: async ({ actor, ask: { agentId, input }, answer }) => {
        await connectProposed({ actor, agentId, proposal: proposalOf(input), token: answer.key })
        return 'You restart to pick it up right after this reply.'
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

function proposalOf(input: object): ProposedConnection {
  const parsed = mini.safeParse(ProposedConnection, input)
  if (!parsed.success) throw new HttpError(400, `That proposal isn't valid. ${describeIssues(parsed.error.issues)}`)
  return parsed.data
}

async function connectProposed({ actor, agentId, proposal, token }: { actor: Caller; agentId: string; proposal: ProposedConnection; token?: string }): Promise<void> {
  const key = token?.trim()
  if (!key) throw new HttpError(400, `Paste the ${proposal.token.label}.`, { param: 'token' })
  if (/\s/.test(key)) throw new HttpError(400, `Paste the ${proposal.token.label} as it is, with no spaces.`, { param: 'token' })
  const connection = await connectionService.create({ actor, kind: 'mcp', name: proposal.name, url: proposal.url, header: `Authorization: Bearer ${key}` })
  try {
    const specs = await connectionService.specs({ actor, connectionId: connection.id })
    for (const { group, permission } of proposal.groups) {
      const tools = specs.filter((spec) => permissions.groupOf(spec) === group).map((spec) => spec.name)
      if (tools.length) await permissions.set({ actor, agentId, connectionId: connection.id, tools, state: permission })
    }
    await agentService.createGrant({ actor, agentId, connectionId: connection.id })
  } catch (err) {
    await connectionService.delete({ actor, id: connection.id })
    throw err
  }
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
