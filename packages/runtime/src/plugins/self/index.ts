import { definePlugin } from '../../core/plugin.ts'

export const self = definePlugin({
  name: 'self',
  hermes: ({ agent }) => ({ prompt: agent.instructions }),
})
