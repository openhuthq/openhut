import * as z from 'zod/mini'
import { HttpError } from '../../server/platform/http-error.ts'
import { discordPlace, threadService } from '../../server/threads/thread-service.ts'

const MAX_TEXT = 200_000
const Id = z.optional(z.nullable(z.string().check(z.maxLength(200))))
const Turn = z.object({
  user: z.string().check(z.maxLength(MAX_TEXT)),
  reply: z.string().check(z.maxLength(MAX_TEXT)),
  origin: z.looseObject({ platform: z.string().check(z.maxLength(40)), chat_id: z.string().check(z.minLength(1), z.maxLength(200)), chat_name: Id, thread_id: Id, parent_chat_id: Id, user_name: Id }),
})

const Where = z.object({ origin: z.looseObject({ platform: z.string().check(z.maxLength(40)), chat_id: z.string().check(z.minLength(1), z.maxLength(200)), thread_id: Id, parent_chat_id: Id }) })

export async function threadContext({ agentId, body }: { agentId: string; body: unknown }): Promise<{ object: 'thread_context'; context: string | null }> {
  const where = z.safeParse(Where, body)
  if (!where.success) throw new HttpError(400, 'Send the chat\'s origin.')
  return threadService.contextFor({ agentId, origin: where.data.origin })
}

export async function reportTurn({ agentId, body }: { agentId: string; body: unknown }): Promise<{ object: 'thread'; id: string }> {
  const turn = z.safeParse(Turn, body)
  if (!turn.success) throw new HttpError(400, 'Send user, reply and the chat\'s origin.')
  const { user, reply, origin } = turn.data
  if (origin.platform !== 'discord') throw new HttpError(400, `Turns from ${origin.platform} aren't recorded yet.`)
  return threadService.recordTurn({ agentId, origin: discordPlace(origin), user, author: origin.user_name || 'Someone on Discord', reply })
}
