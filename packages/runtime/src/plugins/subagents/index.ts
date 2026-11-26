import { definePlugin } from '../../core/plugin.ts'
import { subagentController } from './subagent-controller.ts'
import { subagentService } from './subagent-service.ts'

export const subagents = definePlugin({
  name: 'subagents',
  hermes: () => ({ config: { delegation: { max_spawn_depth: 1, max_concurrent_children: 1000, gateway_mode: 'inline' } } }),
  hooks: {
    subagent_start: async ({ agent, args }) => subagentService.started({ agentId: agent.id, args }),
    subagent_stop: async ({ agent, args }) => subagentService.stopped({ agentId: agent.id, args }),
  },
  routes: () => ({ '/api/agents': subagentController }),
})
