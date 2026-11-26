import { CARD_PROMPT } from '@openhut/common/cards/card.ts'
import { definePlugin } from '../../core/plugin.ts'

export const cards = definePlugin({
  name: 'cards',
  hermes: () => ({ prompt: CARD_PROMPT }),
})
