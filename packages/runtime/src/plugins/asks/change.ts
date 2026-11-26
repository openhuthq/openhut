import * as z from 'zod'
import type { ChangeAction } from '@openhut/common/agents/change-request.ts'
import { defineTool, type Tool } from '../../core/plugin.ts'
import { changeRequestService } from '../../server/agents/change-request-service.ts'

export function changeTool({ action, description, input }: { action: ChangeAction; description: string; input: z.ZodRawShape }): Tool {
  return defineTool({
    description: `${description} Your owner approves it in OpenHut first: the call returns at once, and the answer comes back to you as a message.`,
    input: { why: z.string().min(1).max(300).describe('One sentence for your owner: why this change, in plain words.'), ...input },
    run: async ({ why: because, ...rest }, { agent, origin }) => changeRequestService.ask({ agentId: agent.id, action, input: rest, why: String(because), origin }),
  })
}
