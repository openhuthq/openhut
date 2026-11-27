import * as z from 'zod'
import { definePlugin, defineTool } from '../../core/plugin.ts'
import { channelService } from '../../server/channels/channel-service.ts'
import { chat } from '../../server/chat/index.ts'
import { log } from '../../server/platform/events.ts'

export const post = definePlugin({
  name: 'post',
  tools: {
    post_message: defineTool({
      local: true,
      description: 'Post a message in one of your own channels without being asked there first, like a report for the team. get_self\'s postTo lists where you can post. You can\'t post anywhere else.',
      input: {
        channel: z.string().max(40).describe('The channel id from postTo.'),
        chat: z.string().max(200).optional().describe('The chat from postTo. Leave out for the channel\'s first one.'),
        message: z.string().trim().min(1, 'Send the message to post.').describe('What to post, in plain words.'),
      },
      run: async ({ channel, chat: room, message }, { agent }) => {
        const found = await channelService.postTarget({ agentId: agent.id, channel, chat: room })
        log.info({ event: 'message.posted', agent: agent.id, channel: found.channel })
        const [platform, chatId = ''] = found.target.split(/:(.*)/)
        if (platform !== 'discord') return { send: { target: found.target, message } }
        await chat.send({ agentId: agent.id, place: { platform, chat_id: chatId, chat_name: found.place }, text: message })
        return `Posted in ${found.place}.`
      },
    }),
  },
})
