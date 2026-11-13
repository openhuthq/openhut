import type { Audience } from '@jakebox/common/channels/channel.ts'
import { config } from '../../platform/config.ts'
import { HttpError } from '../../platform/http-error.ts'

export const slack = {
  async verify({ botToken, appToken }: { botToken: string; appToken: string }): Promise<string> {
    const bot = await call({ method: 'auth.test', token: botToken })
    if (!bot.ok) throw new HttpError(400, `Slack didn't accept the bot token (${bot.error}). Copy it again from OAuth & Permissions.`, { param: 'botToken' })
    const app = await call({ method: 'apps.connections.open', token: appToken })
    if (!app.ok) throw new HttpError(400, `Slack didn't accept the app-level token (${app.error}). Make one with the connections:write scope.`, { param: 'appToken' })
    return `${bot.team} · @${bot.user}`
  },

  env({ botToken, appToken, audience }: { botToken: string; appToken: string; audience: Audience }): string[] {
    const who = audience.open ? 'SLACK_ALLOW_ALL_USERS=true' : `SLACK_ALLOWED_USERS=${[audience.ownerAddress, ...audience.allowed].join(',')}`
    return [`SLACK_BOT_TOKEN=${botToken}`, `SLACK_APP_TOKEN=${appToken}`, who]
  },

  yaml: 'slack:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n',

  approver: (audience: Audience): string => audience.ownerAddress,
}

async function call({ method, token }: { method: string; token: string }): Promise<SlackReply> {
  const res = await fetch(`${config.slackApi}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    .catch((err: Error) => { throw new HttpError(502, `Slack didn't answer (${err.message}). Try again.`) })
  const body: unknown = await res.json().catch(() => undefined)
  if (!isSlackReply(body)) return { ok: false, error: `HTTP ${res.status}` }
  return body
}

const isSlackReply = (body: unknown): body is SlackReply => typeof body === 'object' && body !== null && 'ok' in body

type SlackReply = { ok: boolean; error?: string; team?: string; user?: string }
