import * as z from 'zod/mini'
import type { Audience } from '@openhut/common/channels/channel.ts'
import { config } from '../../platform/config.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const Me = z.object({ ok: z.literal(true), result: z.object({ username: z.string() }) })
const Failure = z.object({ ok: z.literal(false), description: z.string() })
export const TelegramSecrets = z.object({ botToken: z.string() })

export const telegram = {
  async verify({ botToken }: { botToken: string }): Promise<string> {
    const res = await fetch(`${config.telegramApi}/bot${botToken}/getMe`, { signal: AbortSignal.timeout(10_000) })
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
    return [`TELEGRAM_BOT_TOKEN=${botToken}`, who, `TELEGRAM_HOME_CHANNEL=${audience.ownerAddress}`]
  },

  yaml({ gateway }: { gateway: string }): string {
    return [
      'telegram:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n  gateway_restart_notification: false',
      `platforms:\n  telegram:\n    extra:\n      base_url: ${gateway}/u/telegram/bot\n      base_file_url: ${gateway}/u/telegram/file/bot`,
    ].join('\n')
  },
}
