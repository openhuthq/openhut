import * as z from 'zod'
import { defineAsk, definePlugin, defineTool } from '../../core/plugin.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import type { GatewayAgent } from '../../server/agents/agent-service.ts'
import { channelService } from '../../server/channels/channel-service.ts'
import { inboxService } from '../../server/inbox/inbox-service.ts'
import { db } from '../../server/platform/db.ts'

const SelfChange = z.object({ name: z.string().min(1).max(40).optional(), instructions: z.string().max(20_000).optional() })
  .refine((change) => change.name !== undefined || change.instructions !== undefined, 'Send a new name, new instructions, or both.')

export const self = definePlugin({
  name: 'self',
  hermes: ({ agent }) => ({ prompt: agent.instructions }),
  tools: {
    get_self: defineTool({
      description: 'Your name, instructions and channels, where post_message can post (postTo), the connections you have, and the ones you can ask for. Read it before you ask to change any of them.',
      input: {},
      run: async (_, { agent }) => selfOf(agent),
    }),
  },
  asks: {
    update_self: defineAsk({
      input: SelfChange,
      answer: SelfChange,
      tool: 'Ask to change your own name or instructions. Send the whole new instructions, not a diff.',
      title: ({ input }) => [input.name !== undefined && `Rename to ${input.name}`, input.instructions !== undefined && 'Change its instructions'].filter(Boolean).join(' and '),
      run: async ({ actor, ask, answer }) => {
        await agentService.update({ actor, id: ask.agentId, patch: answer })
        return answer.instructions === undefined ? undefined : 'Your new instructions are already in effect.'
      },
    }),
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
