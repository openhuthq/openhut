import * as z from 'zod/mini'
import { config } from '../../platform/config.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const Me = z.object({ username: z.string() })
const App = z.object({ flags: z.optional(z.number()) })
const MESSAGE_CONTENT = (1 << 18) | (1 << 19)
export const DiscordSecrets = z.object({ botToken: z.string() })

export const discord = {
  async verify({ botToken, channels }: { botToken: string; channels: string[] }): Promise<string> {
    const me = await call({ path: '/users/@me', botToken })
    const user = z.safeParse(Me, me.body)
    if (!me.ok || !user.success) throw new HttpError(400, `Discord didn't accept the bot token (HTTP ${me.status}). Reset it on the Bot page and copy it again.`, { param: 'botToken' })
    const app = z.safeParse(App, (await call({ path: '/applications/@me', botToken })).body)
    if (!app.success || !((app.data.flags ?? 0) & MESSAGE_CONTENT)) throw new HttpError(400, 'Turn on Message Content Intent on the Bot page, then connect again.', { param: 'botToken' })
    await discord.enter({ botToken, ids: channels, bot: `@${user.data.username}` })
    return `@${user.data.username}`
  },

  async enter({ botToken, ids, bot }: { botToken: string; ids: string[]; bot: string }): Promise<void> {
    for (const id of ids) {
      const seen = await call({ path: `/channels/${id}`, botToken })
      if (!seen.ok) throw new HttpError(400, `${bot} can't see channel ${id} (HTTP ${seen.status}). Invite it to the server and give it access to the channel.`, { param: 'allowed' })
    }
  },

  env({ botToken, channels }: { botToken: string; channels: string[] }): string[] {
    if (!channels.length) return []
    return [`DISCORD_BOT_TOKEN=${botToken}`, `DISCORD_ALLOWED_CHANNELS=${channels.join(',')}`, `DISCORD_HOME_CHANNEL=${channels[0]}`]
  },

  yaml: 'discord:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n  gateway_restart_notification: false',
}

async function call({ path, botToken }: { path: string; botToken: string }): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.discordApi}${path}`, { headers: { authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(10_000) })
    .catch((err: unknown) => { throw new HttpError(502, `Discord didn't answer (${messageOf(err).replaceAll(botToken, '…')}). Try again.`) })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => undefined) }
}
