import * as z from 'zod/mini'
import type { Audience } from '@fastmonkey/common/channels/channel.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const TELEGRAM_API = 'https://api.telegram.org'
const Me = z.object({ ok: z.literal(true), result: z.object({ username: z.string() }) })
const Failure = z.object({ ok: z.literal(false), description: z.string() })

export const telegram = {
  async verify({ botToken }: { botToken: string }): Promise<string> {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`, { signal: AbortSignal.timeout(10_000) })
      .catch((err: unknown) => { throw new HttpError(502, `Telegram didn't answer (${messageOf(err).replaceAll(botToken, '…')}). Try again.`) })
    const body: unknown = await res.json().catch(() => undefined)
    const me = z.safeParse(Me, body)
    if (me.success) return `@${me.data.result.username}`
    const failure = z.safeParse(Failure, body)
    const reason = failure.success ? failure.data.description : `HTTP ${res.status}`
    throw new HttpError(400, `Telegram didn't accept the bot token (${reason}). Copy it again from BotFather.`, { param: 'botToken' })
  },

  env({ botToken, audience }: { botToken: string; audience: Audience }): string[] {
    const who = audience.open ? 'TELEGRAM_ALLOW_ALL_USERS=true' : `TELEGRAM_ALLOWED_USERS=${[audience.ownerAddress, ...audience.allowed].join(',')}`
    return [`TELEGRAM_BOT_TOKEN=${botToken}`, who]
  },

  yaml: 'telegram:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n',
}
