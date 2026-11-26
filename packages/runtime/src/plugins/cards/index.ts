import * as z from 'zod'
import { CARD_PROMPT } from '@openhut/common/cards/card.ts'
import { APP_PLATFORM, definePlugin } from '../../core/plugin.ts'
import { cardService } from '../../server/cards/card-service.ts'

const Reply = z.object({ response_text: z.string(), platform: z.string().nullish() })
const Chat = z.object({ chat_id: z.string().optional(), thread_id: z.string().optional() })
const Clicked = z.object({
  channel: z.object({ id: z.string() }).optional(),
  message: z.object({ ts: z.string().optional(), thread_ts: z.string().optional() }).optional(),
  user: z.object({ id: z.string() }).optional(),
  team: z.object({ id: z.string() }).optional(),
})

export const cards = definePlugin({
  name: 'cards',
  hermes: () => ({ prompt: CARD_PROMPT }),
  hooks: {
    transform_llm_output: async ({ agent, args, origin }) => {
      const { response_text: text, platform } = Reply.parse(args)
      if (!platform || platform === APP_PLATFORM) return undefined
      const chat = Chat.safeParse(origin).data
      const rendered = (await cardService.render({ agent, text, channel: platform, chatId: chat?.chat_id, threadId: chat?.thread_id })).text
      return rendered === text ? undefined : rendered
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
