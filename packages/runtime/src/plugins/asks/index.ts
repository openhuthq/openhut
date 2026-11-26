import * as z from 'zod'
import { ASK_PROMPT, askCard, MCP_AUTH } from '@openhut/common/asks/ask.ts'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'
import { definePlugin, defineTool } from '../../core/plugin.ts'
import { changeTool } from './change.ts'

export const asks = definePlugin({
  name: 'asks',
  hermes: () => ({ prompt: ASK_PROMPT }),
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
    propose_connection: changeTool({
      action: 'propose_connection',
      description: 'Propose connecting an app that isn\'t on ask_to_connect\'s list, through its official remote MCP server that takes a token. Your owner sees a card, makes the token with your guide and pastes it in OpenHut; you never see it. Say what each kind of tool may do.',
      input: {
        name: z.string().min(1).max(60).describe('The app, like DigitalOcean.'),
        line: z.string().max(120).optional().describe('What it is to the person, a few plain words: "where your database runs".'),
        url: z.url({ protocol: /^https$/ }).max(500).describe('The official remote MCP server, like https://mcp.digitalocean.com/mcp.'),
        token: z.object({
          label: z.string().min(1).max(60).describe('What the token is called, like DigitalOcean token.'),
          guide: z.string().min(1).max(300).describe('One or two plain sentences: where to make it and what access to give.'),
          link: z.url({ protocol: /^https$/ }).max(500).describe('The page where they make it.'),
          scopes: z.array(z.string().max(100)).max(30).optional().describe('The scopes it needs, as the app names them.'),
        }),
        groups: z.array(z.object({
          group: z.enum(['read', 'create', 'update', 'delete', 'other']).describe('other: tools the app doesn\'t label, and one generic tool that runs any other tool (like mcp_invoke_tool), so it can do anything.'),
          label: z.string().min(1).max(80).describe('What these tools do here, in plain words: "Read database info".'),
          permission: z.enum(['allow', 'ask', 'deny']).describe('allow runs without asking, ask waits for their OK each time, deny never runs. Usually: read allow, create and update ask, delete deny.'),
        })).min(1).max(5).describe('One entry per kind of tool the job needs.'),
      },
    }),
    add_secret: changeTool({
      action: 'add_secret',
      description: 'Ask your owner for an API key or token you need, like a Stripe key. They paste it in OpenHut; you never see it. Once saved, call the service through $OPENHUT_GATEWAY/x/<host>/<path> and OpenHut adds the key, only for the hosts you list. Never ask anyone to paste a key into a chat.',
      input: {
        name: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).describe('Capitals, digits and _, like STRIPE_KEY. Your terminal gets $OPENHUT_SECRET_<name>, a stand-in, never the key.'),
        hosts: z.array(z.string().max(253)).min(1).max(10).describe('The API hosts the key may go to, like api.stripe.com. No https://, no path.'),
        header: z.string().max(200).optional().describe('How the service wants it, with {value} for the key. Default: Authorization: Bearer {value}. Stripe: Authorization: Bearer {value}; others: X-Api-Key: {value}.'),
      },
    }),
    request_connection: changeTool({ action: 'request_connection', description: 'Ask for a connection that already exists in OpenHut (get_self lists them). For an app nobody connected yet, use ask_to_connect.', input: { connectionId: z.string().max(40) } }),
  },
})
