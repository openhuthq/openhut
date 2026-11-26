import { definePlugin } from '../../core/plugin.ts'

export const base = definePlugin({
  name: 'base',
  hermes: ({ agent }) => ({
    config: {
      terminal: { backend: 'local' },
      agent: { api_max_retries: 30, disabled_toolsets: ['browser', 'delegation', 'cronjob', 'connections', ...(agent.code_execution ? [] : ['code_execution'])] },
      approvals: { mode: 'off' },
      tools: { tool_search: { enabled: 'off' } },
    },
  }),
})
