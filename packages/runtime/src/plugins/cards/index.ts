import * as z from 'zod'
import { CARD_PROMPT } from '@openhut/common/cards/card.ts'
import { APP_PLATFORM, definePlugin } from '../../core/plugin.ts'
import { cardService } from '../../server/cards/card-service.ts'

const Clicked = z.object({
  channel: z.object({ id: z.string() }).optional(),
  message: z.object({ ts: z.string().optional(), thread_ts: z.string().optional() }).optional(),
  user: z.object({ id: z.string() }).optional(),
  team: z.object({ id: z.string() }).optional(),
})

export const cards = definePlugin({
  name: 'cards',
  agent: () => ({ instructions: CARD_PROMPT }),
  on: {
    'reply.drafted': async ({ agent, event: { text, source } }) => {
      if (!source || source.platform === APP_PLATFORM) return undefined
      const rendered = (await cardService.render({ agent, text, channel: source.platform, chatId: source.chatId, threadId: source.threadId })).text
      return rendered === text ? undefined : { text: rendered }
    },
  },
  slackAction: {
    prefix: 'card:',
    run: async ({ body, action }) => {
      const { channel, message, user, team } = Clicked.parse(body)
      const chat = channel?.id ?? ''
      return {
        text: action.value ?? '',
        origin: { platform: 'slack', chat_id: chat, chat_type: chat.startsWith('D') ? 'dm' : 'group', user_id: user?.id, thread_id: message?.thread_ts ?? message?.ts, scope_id: team?.id },
      }
    },
  },
})
