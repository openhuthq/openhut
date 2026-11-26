import { definePlugin } from '../../core/plugin.ts'
import { config } from '../../server/platform/config.ts'
import { AGENT_API_PORT_BASE } from '../../agentd/sandbox/sandbox.ts'

export const chat = definePlugin({
  name: 'chat',
  hermes: ({ agent, channelKey }) => ({
    config: { platform_toolsets: { api_server: ['hermes-api-server', 'openhut'] } },
    env: {
      API_SERVER_KEY: channelKey,
      ...(config.agentHostNet ? { API_SERVER_HOST: '127.0.0.1', API_SERVER_PORT: String(AGENT_API_PORT_BASE + agent.net) } : { API_SERVER_HOST: '0.0.0.0', API_SERVER_PORT: '8642' }),
    },
  }),
})
