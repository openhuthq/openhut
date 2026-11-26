import * as z from 'zod'
import { definePlugin, defineTool } from '../../core/plugin.ts'
import type { GatewayAgent } from '../../server/agents/agent-service.ts'
import { channelService } from '../../server/channels/channel-service.ts'
import { inboxService } from '../../server/inbox/inbox-service.ts'
import { db } from '../../server/platform/db.ts'
import { changeTool } from '../asks/change.ts'

export const self = definePlugin({
  name: 'self',
  hermes: ({ agent }) => ({ prompt: agent.instructions }),
  tools: {
    get_self: defineTool({
      description: 'Your name, instructions and channels, where post_message can post (postTo), the connections you have, and the ones you can ask for. Read it before you ask to change any of them.',
      input: {},
      run: async (_, { agent }) => selfOf(agent),
    }),
    update_self: changeTool({ action: 'update_self', description: 'Ask to change your own name or instructions. Send the whole new instructions, not a diff.', input: { name: z.string().min(1).max(40).optional(), instructions: z.string().max(20_000).optional() } }),
  },
})

async function selfOf(agent: GatewayAgent): Promise<string> {
  const [row, channels, connections, grants, postTo, hooks] = await Promise.all([
    db.selectFrom('agent').select(['name', 'instructions']).where('id', '=', agent.id).executeTakeFirstOrThrow(),
    channelService.list({ agentId: agent.id }),
    db.selectFrom('connection').select(['id', 'name', 'kind']).orderBy('created_at').execute(),
    db.selectFrom('connection_grant').select('connection_id').where('agent_id', '=', agent.id).execute(),
    channelService.postTargets({ agentId: agent.id }),
    inboxService.forAgent({ agentId: agent.id }),
  ])
  const have = new Set(grants.map((grant) => grant.connection_id))
  return JSON.stringify({
    name: row.name,
    instructions: row.instructions,
    channels: channels.map(({ id, kind, status, account, open, allowed }) => ({ id, kind, status, account, open, allowed })),
    connections: connections.filter((each) => have.has(each.id)),
    canAskFor: connections.filter((each) => !have.has(each.id)),
    postTo: postTo.map(({ channel, chat, place }) => ({ channel, chat, place })),
    webhooks: hooks,
  }, null, 2)
}
