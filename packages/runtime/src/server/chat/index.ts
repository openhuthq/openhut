import type { ChatMessage } from '@openhut/common/threads/thread.ts'
import { durable } from '../../core/durable.ts'
import { channelService } from '../channels/channel-service.ts'
import { messageOf } from '../platform/http-error.ts'
import { threadService, type ThreadPlace } from '../threads/thread-service.ts'
import { bots } from './bots.ts'

export type Inbound = { agentId: string; place: ThreadPlace; title: string; said: { ref: string; at: Date; author: string; text: string }[] }

const turn = durable<{ threadId: string }>('chat-turn', 'latest', async ({ threadId }) => {
  const typing = await bots.typing(threadId)
  try {
    await threadService.answer({ threadId })
  } finally {
    typing()
  }
  await chat.flush(threadId)
})

const deliver = durable<{ threadId: string; messageId: string }>('chat-deliver', 'each', async ({ threadId, messageId }, { last }) => {
  const [message, where] = await Promise.all([threadService.message({ threadId, messageId }), threadService.whereOf(threadId)])
  if (!message || !where.place || metadataOf(message).delivery !== 'pending') return
  const place = where.place
  try {
    const sent = await channelService.send({ agentId: where.agentId, place, text: textOf(message), ...!place.thread_id && where.origin === 'webhook' && { startThread: where.title } })
    if (sent.threadId) await threadService.moved({ id: threadId, place: { ...place, thread_id: sent.threadId, url: sent.url } })
    await threadService.updateMetadata({ threadId, messageId, change: (metadata) => ({ ...metadata, delivery: 'sent', ref: sent.messageId }) })
  } catch (err) {
    if (last) await threadService.updateMetadata({ threadId, messageId, change: (metadata) => ({ ...metadata, delivery: 'failed', error: messageOf(err) }) })
    throw err
  }
})

export const chat = {
  start: (): void => bots.start(),

  async receive({ agentId, place, title, said }: Inbound): Promise<string> {
    const threadId = await threadService.placeThread({ agentId, place, title })
    const messages: ChatMessage[] = said.filter((each) => each.text.trim()).map((each) => ({ id: threadService.inboundId(each), role: 'user', parts: [{ type: 'text', text: each.text }], metadata: { author: each.author, ref: each.ref } }))
    await threadService.add({ threadId, messages })
    await turn.send(threadId, { threadId })
    return threadId
  },

  async send({ agentId, place, text }: { agentId: string; place: ThreadPlace; text: string }): Promise<string> {
    const threadId = await threadService.placeThread({ agentId, place })
    await threadService.post({ threadId, text })
    await chat.flush(threadId)
    return threadId
  },

  async flush(threadId: string): Promise<void> {
    for (const messageId of await threadService.undelivered(threadId)) await deliver.send(threadId, { threadId, messageId })
  },
}

const metadataOf = (message: ChatMessage): Record<string, unknown> => (message.metadata ?? {}) as Record<string, unknown>

const textOf = (message: ChatMessage): string => message.parts.map((part) => part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('')
