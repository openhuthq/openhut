import * as z from 'zod/mini'
import type { Place } from '@openhut/common/channels/channel.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import { Origin } from '../../server/inbox/routines.ts'
import { threadService } from '../../server/threads/thread-service.ts'

const MAX_TEXT = 200_000
const Turn = z.object({
  user: z.string().check(z.maxLength(MAX_TEXT)),
  reply: z.string().check(z.maxLength(MAX_TEXT)),
  origin: z.extend(Origin, { parent_chat_id: z.optional(z.nullable(z.string().check(z.maxLength(200)))) }),
})

export async function reportTurn({ agentId, body }: { agentId: string; body: unknown }): Promise<{ object: 'thread'; id: string }> {
  const turn = z.safeParse(Turn, body)
  if (!turn.success) throw new HttpError(400, 'Send user, reply and the chat\'s origin.')
  const { user, reply, origin } = turn.data
  if (origin.platform !== 'discord') throw new HttpError(400, `Turns from ${origin.platform} aren't recorded yet.`)
  return threadService.recordTurn({ agentId, origin: discordPlace(origin), user, author: origin.user_name || 'Someone on Discord', reply })
}

export function discordPlace(origin: Origin & { parent_chat_id?: string | null }): Place {
  const inThread = !!origin.thread_id && origin.thread_id === origin.chat_id && !!origin.parent_chat_id
  return {
    platform: 'discord',
    chat_id: inThread ? origin.parent_chat_id ?? origin.chat_id : origin.chat_id,
    ...origin.thread_id && { thread_id: origin.thread_id },
    chat_name: origin.chat_name ?? '',
  }
}
