import { definePlugin } from '../../core/plugin.ts'

export const subagents = definePlugin({
  name: 'subagents',
  hermes: () => ({ config: { delegation: { max_spawn_depth: 1, max_concurrent_children: 1000, gateway_mode: 'inline' } } }),
})
