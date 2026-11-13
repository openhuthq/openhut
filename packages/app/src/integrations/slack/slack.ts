import * as z from 'zod/mini'
import type { Audience } from '@fastmonkey/common/channels/channel.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const SLACK_API = 'https://slack.com/api'
const SlackOk = z.object({ ok: z.literal(true), team: z.optional(z.string()), user: z.optional(z.string()) })
const SlackFailure = z.object({ ok: z.literal(false), error: z.string() })

export const slack = {
  async verify({ botToken, appToken }: { botToken: string; appToken: string }): Promise<string> {
    const bot = await call({ method: 'auth.test', token: botToken })
    if (!bot.ok) throw new HttpError(400, `Slack didn't accept the bot token (${bot.error}). Copy it again from OAuth & Permissions.`, { param: 'botToken' })
    const app = await call({ method: 'apps.connections.open', token: appToken })
    if (!app.ok) throw new HttpError(400, `Slack didn't accept the app-level token (${app.error}). Make one with the connections:write scope.`, { param: 'appToken' })
    if (!bot.team || !bot.user) throw new HttpError(502, 'Slack accepted the bot token but didn\'t name the workspace and bot. Try again.')
    return `${bot.team} · @${bot.user}`
  },

  env({ botToken, appToken, audience }: { botToken: string; appToken: string; audience: Audience }): string[] {
    const who = audience.open ? 'SLACK_ALLOW_ALL_USERS=true' : `SLACK_ALLOWED_USERS=${[audience.ownerAddress, ...audience.allowed].join(',')}`
    return [`SLACK_BOT_TOKEN=${botToken}`, `SLACK_APP_TOKEN=${appToken}`, who]
  },

  yaml: 'slack:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n',
}

async function call({ method, token }: { method: string; token: string }): Promise<z.infer<typeof SlackOk> | z.infer<typeof SlackFailure>> {
  const res = await fetch(`${SLACK_API}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    .catch((err: unknown) => { throw new HttpError(502, `Slack didn't answer (${messageOf(err)}). Try again.`) })
  const body: unknown = await res.json().catch(() => undefined)
  const ok = z.safeParse(SlackOk, body)
  if (ok.success) return ok.data
  const failure = z.safeParse(SlackFailure, body)
  return failure.success ? failure.data : { ok: false, error: `HTTP ${res.status}` }
}
