import { ASK_PROMPT } from '@openhut/common/asks/ask.ts'
import { definePlugin } from '../../core/plugin.ts'

export const asks = definePlugin({
  name: 'asks',
  hermes: () => ({ prompt: ASK_PROMPT }),
})
