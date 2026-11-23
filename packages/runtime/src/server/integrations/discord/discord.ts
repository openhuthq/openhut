import * as z from 'zod/mini'
import type { Conversation } from '@openhut/common/channels/channel.ts'
import { config } from '../../platform/config.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const Me = z.object({ username: z.string() })
const App = z.object({ flags: z.optional(z.number()), bot_public: z.optional(z.boolean()) })
const Guild = z.object({ id: z.string(), name: z.string() })
const GuildChannel = z.object({ id: z.string(), name: z.string(), type: z.number() })
const TEXT = new Set([0, 5])
const PERMISSIONS = '309237713920'
const MESSAGE_CONTENT = (1 << 18) | (1 << 19)
export const DiscordSecrets = z.object({ botToken: z.string() })

export const discord = {
  async verify({ botToken, channels }: { botToken: string; channels: string[] }): Promise<string> {
    const me = await call({ path: '/users/@me', botToken })
    const user = z.safeParse(Me, me.body)
    if (!me.ok || !user.success) throw new HttpError(400, `Discord didn't accept the bot token (HTTP ${me.status}). Reset it on the Bot page and copy it again.`, { param: 'botToken' })
    const app = z.safeParse(App, (await call({ path: '/applications/@me', botToken })).body)
    if (!app.success || !((app.data.flags ?? 0) & MESSAGE_CONTENT)) throw new HttpError(400, 'Turn on Message Content Intent on the Bot page, then paste the token again.', { param: 'botToken' })
    if (app.data.bot_public) throw new HttpError(400, `Turn Public Bot off on the Bot page, so nobody else can add @${user.data.username} to their server. Then paste the token again.`, { param: 'botToken' })
    await discord.enter({ botToken, ids: channels, bot: `@${user.data.username}` })
    return `@${user.data.username}`
  },

  async enter({ botToken, ids, bot }: { botToken: string; ids: string[]; bot: string }): Promise<void> {
    for (const id of ids) {
      const seen = await call({ path: `/channels/${id}`, botToken })
      if (!seen.ok) throw new HttpError(400, `${bot} can't see channel ${id} (HTTP ${seen.status}). Invite it to the server and give it access to the channel.`, { param: 'allowed' })
    }
  },

  invite(botToken: string): string {
    const id = Buffer.from(botToken.split('.')[0] ?? '', 'base64').toString('utf8')
    return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: id, permissions: PERMISSIONS, scope: 'bot' })}`
  },

  async conversations({ botToken }: { botToken: string }): Promise<Conversation[]> {
    const guilds = await call({ path: '/users/@me/guilds', botToken })
    const list = z.safeParse(z.array(Guild), guilds.body)
    if (!guilds.ok || !list.success) throw new HttpError(502, `Discord didn't list the bot's servers (HTTP ${guilds.status}). Try again.`)
    const all = await Promise.all(list.data.map(async (guild) => {
      const channels = z.safeParse(z.array(GuildChannel), (await call({ path: `/guilds/${guild.id}/channels`, botToken })).body)
      return (channels.success ? channels.data : []).filter((each) => TEXT.has(each.type))
        .map((each): Conversation => ({ id: each.id, object: 'conversation', name: each.name, type: 'public', shared: false, members: 0, joined: true, group: guild.name }))
    }))
    return all.flat()
  },

  async greet({ botToken, ids, bot }: { botToken: string; ids: string[]; bot: string }): Promise<string[]> {
    const failed: string[] = []
    for (const id of ids) {
      const res = await fetch(`${config.discordApi}/channels/${id}/messages`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: `Hi, I'm ${bot.replace(/^@/, '')}. Mention ${bot} and I'll answer in a thread.` }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
      if (!res?.ok) failed.push(id)
    }
    return failed
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
