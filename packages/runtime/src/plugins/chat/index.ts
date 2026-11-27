import { definePlugin } from '../../core/plugin.ts'
import { config } from '../../server/platform/config.ts'
import { AGENT_API_PORT, AGENT_API_PORT_BASE } from '../../agentd/network/ports.ts'
import { deliverAppWakes } from './wakes.ts'
import { chat as hub } from '../../server/chat/index.ts'
import { threadController } from '../../server/threads/thread-controller.ts'
import { createTables } from './tables.ts'
import { notified, notifyController, notifyPrompt, notifyTool } from './notify.ts'

export const chat = definePlugin({
  name: 'chat',
  migrate: createTables,
  routes: () => ({ '/api/threads': threadController, '/api/agents/:id/notify': notifyController }),
  tools: { notify: notifyTool },
  afterTurn: async (input) => notified(input),
  agent: ({ agent, channelKey }) => ({
    instructions: notifyPrompt(agent.notify),
    native: {
      hermes: {
        config: { platform_toolsets: { api_server: ['hermes-api-server', 'openhut', 'openhut-local'] } },
        env: {
          API_SERVER_KEY: channelKey,
          ...(config.agentHostNet ? { API_SERVER_HOST: '127.0.0.1', API_SERVER_PORT: String(AGENT_API_PORT_BASE + agent.net) } : { API_SERVER_HOST: '0.0.0.0', API_SERVER_PORT: String(AGENT_API_PORT) }),
        },
      },
    },
  }),
  start: () => {
    deliverAppWakes()
    hub.start()
  },
})
