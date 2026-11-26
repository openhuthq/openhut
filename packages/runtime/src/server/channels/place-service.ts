import { ChannelSecrets, type Place, type Sent } from '@openhut/common/channels/channel.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { unseal } from '../platform/secrets.ts'
import { discord } from '../integrations/discord/discord.ts'
import { channelService } from './channel-service.ts'

type Sender = (input: { botToken: string; place: Place; text: string; startThread?: string }) => Promise<Sent>

const SENDERS: Record<string, Sender> = {
  discord: ({ botToken, place, text, startThread }) => discord.post({ botToken, channelId: place.thread_id ?? place.chat_id, text, startThread: place.thread_id ? undefined : startThread }),
}

export const placeService = {
  async list({ agentId }: { agentId: string }): Promise<Place[]> {
    const targets = await channelService.postTargets({ agentId })
    return targets.map((each) => ({ platform: each.target.split(':')[0] ?? '', chat_id: each.chat, chat_name: each.place })).filter((place) => place.platform in SENDERS)
  },

  async send({ agentId, place, text, startThread }: { agentId: string; place: Place; text: string; startThread?: string }): Promise<Sent> {
    const sender = SENDERS[place.platform]
    if (!sender) throw new HttpError(400, `OpenHut can't post to ${place.platform} yet. Pick a Discord channel.`)
    if (!text.trim()) throw new HttpError(400, 'Send the text to post.')
    const target = (await channelService.postTargets({ agentId })).find((each) => each.target === `${place.platform}:${place.chat_id}`)
    if (!target) throw new HttpError(400, `Can't post in ${place.chat_name || 'that channel'}. Connect it to the agent first.`)
    const row = await db.selectFrom('channel').select('secrets').where('id', '=', target.channel).executeTakeFirstOrThrow()
    const botToken = ChannelSecrets.parse(JSON.parse(unseal(row.secrets))).botToken
    if (!botToken) throw new HttpError(409, 'This channel has no bot token. Connect it again on the agent\'s page.')
    return sender({ botToken, place, text, startThread })
  },
}
