import { definePlugin } from '../../core/plugin.ts'
import { subagentController } from './subagent-controller.ts'
import { subagentService } from './subagent-service.ts'

export const subagents = definePlugin({
  name: 'subagents',
  agent: () => ({ limits: { subagents: { depth: 1, concurrent: 1000 } }, native: { hermes: { config: { delegation: { gateway_mode: 'inline' } } } } }),
  on: {
    'subagent.started': async ({ agent, event }) => subagentService.started({ agentId: agent.id, ...event }),
    'subagent.stopped': async ({ agent, event }) => subagentService.stopped({ agentId: agent.id, ...event }),
  },
  routes: () => ({ '/api/agents': subagentController }),
})
