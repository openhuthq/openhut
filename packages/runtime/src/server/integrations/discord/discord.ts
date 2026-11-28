import * as z from 'zod/mini'
import type { Conversation, Sent } from '@openhut/common/channels/channel.ts'
import { config } from '../../platform/config.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const Me = z.object({ username: z.string() })
const App = z.object({ flags: z.optional(z.number()), bot_public: z.optional(z.boolean()) })
const Guild = z.object({ id: z.string(), name: z.string() })
const Roles = z.object({ roles: z.array(z.object({ id: z.string(), permissions: z.string() })) })
const Member = z.object({ roles: z.array(z.string()) })
const Person = z.object({ nick: z.optional(z.nullable(z.string())), user: z.object({ username: z.string(), global_name: z.optional(z.nullable(z.string())), bot: z.optional(z.boolean()) }) })
const Overwrite = z.object({ id: z.string(), type: z.number(), allow: z.string(), deny: z.string() })
const GuildChannel = z.object({ id: z.string(), name: z.string(), type: z.number(), permission_overwrites: z._default(z.array(Overwrite), []) })
const ADMINISTRATOR = 1n << 3n
const VIEW_CHANNEL = 1n << 10n
const TEXT = new Set([0, 5])
const PERMISSIONS = '309237713920'
const MESSAGE_CONTENT = (1 << 18) | (1 << 19)
const MAX_LENGTH = 2000
const RETRIES = 3
const MAX_WAIT_MS = 30_000
const Target = z.object({ guild_id: z.optional(z.string()), parent_id: z.optional(z.nullable(z.string())) })
const Created = z.object({ id: z.string() })
const Failure = z.object({ message: z.optional(z.string()), retry_after: z.optional(z.number()) })
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

  async name(botToken: string): Promise<string | undefined> {
    const user = z.safeParse(Me, (await call({ path: '/users/@me', botToken })).body)
    return user.success ? `@${user.data.username}` : undefined
  },

  async person({ botToken, guildId, userId }: { botToken: string; guildId: string; userId: string }): Promise<{ name: string; bot: boolean } | undefined> {
    const res = await call({ path: `/guilds/${guildId}/members/${userId}`, botToken }).catch(() => undefined)
    const found = res?.ok ? z.safeParse(Person, res.body).data : undefined
    return found && { name: found.nick || found.user.global_name || found.user.username, bot: found.user.bot === true }
  },

  async places({ botToken, ids }: { botToken: string; ids: string[] }): Promise<Record<string, string>> {
    const guilds = new Map<string, Promise<string | undefined>>()
    const guildName = (id: string) => {
      if (!guilds.has(id)) guilds.set(id, call({ path: `/guilds/${id}`, botToken }).then((res) => z.safeParse(Guild, res.body).data?.name, () => undefined))
      return guilds.get(id)
    }
    const named = await Promise.all(ids.map(async (id) => {
      const channel = z.safeParse(z.object({ name: z.string(), guild_id: z.optional(z.string()) }), (await call({ path: `/channels/${id}`, botToken }).catch(() => undefined))?.body).data
      if (!channel) return []
      const guild = channel.guild_id ? await guildName(channel.guild_id) : undefined
      return [[id, guild ? `${guild} › #${channel.name}` : `#${channel.name}`]]
    }))
    return Object.fromEntries(named.flat())
  },

  async enter({ botToken, ids, bot }: { botToken: string; ids: string[]; bot: string }): Promise<void> {
    for (const id of ids) {
      const seen = await call({ path: `/channels/${id}`, botToken })
      if (!seen.ok) throw new HttpError(400, `${bot} can't see channel ${id}. In Discord, open the channel's settings, then Permissions, and add ${bot}. Then try again.`, { param: 'allowed' })
    }
  },

  invite(botToken: string): string {
    return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: discord.appIdOf(botToken), permissions: PERMISSIONS, scope: 'bot' })}`
  },

  appIdOf: (botToken: string): string => Buffer.from(botToken.split('.')[0] ?? '', 'base64').toString('utf8'),

  async conversations({ botToken }: { botToken: string }): Promise<Conversation[]> {
    const guilds = await call({ path: '/users/@me/guilds', botToken })
    const list = z.safeParse(z.array(Guild), guilds.body)
    if (!guilds.ok || !list.success) throw new HttpError(502, `Discord didn't list the bot's servers (HTTP ${guilds.status}). Try again.`)
    const me = z.safeParse(z.object({ id: z.string() }), (await call({ path: '/users/@me', botToken })).body)
    const all = await Promise.all(list.data.map(async (guild) => {
      const [channels, roles, member] = await Promise.all([
        call({ path: `/guilds/${guild.id}/channels`, botToken }).then((res) => z.safeParse(z.array(GuildChannel), res.body)),
        call({ path: `/guilds/${guild.id}`, botToken }).then((res) => z.safeParse(Roles, res.body)),
        call({ path: `/guilds/${guild.id}/members/${me.data?.id ?? ''}`, botToken }).then((res) => z.safeParse(Member, res.body)),
      ])
      const base = basePermissions({ guildId: guild.id, roles: roles.data?.roles ?? [], mine: member.data?.roles ?? [] })
      return (channels.success ? channels.data : []).filter((each) => TEXT.has(each.type))
        .map((each): Conversation => ({ id: each.id, object: 'conversation', name: each.name, type: isPrivate({ guildId: guild.id, channel: each }) ? 'private' : 'public', shared: false, members: 0, joined: canView({ guildId: guild.id, base, mine: member.data?.roles ?? [], userId: me.data?.id ?? '', channel: each }), group: guild.name }))
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

  async post({ botToken, channelId, threadId, text, startThread }: { botToken: string; channelId: string; threadId?: string; text: string; startThread?: string }): Promise<Sent> {
    const target = threadId ?? channelId
    const found = await call({ path: `/channels/${target}`, botToken })
    const info = z.safeParse(Target, found.body).data
    if (!found.ok || !info) throw new HttpError(400, `The bot can't see that channel (HTTP ${found.status}). In Discord, open the channel's settings, then Permissions, and add the bot.`)
    if (threadId && info.parent_id !== channelId) throw new HttpError(400, 'That thread isn\'t in the channel. Post in the channel instead.')
    const [first = '', ...rest] = split(text)
    const message = await created(write({ path: `/channels/${target}/messages`, botToken, body: { content: first, allowed_mentions: { parse: [] } } }))
    const started = startThread && !threadId ? await created(write({ path: `/channels/${channelId}/messages/${message}/threads`, botToken, body: { name: startThread.slice(0, 100) } })) : undefined
    for (const part of rest) await write({ path: `/channels/${started ?? target}/messages`, botToken, body: { content: part, allowed_mentions: { parse: [] } } })
    const base = `https://discord.com/channels/${info.guild_id ?? '@me'}`
    return started ? { url: `${base}/${started}`, messageId: message, threadId: started } : { url: `${base}/${target}/${message}`, messageId: message }
  },
}

async function call({ path, botToken }: { path: string; botToken: string }): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.discordApi}${path}`, { headers: { authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(10_000) })
    .catch((err: unknown) => { throw new HttpError(502, `Discord didn't answer (${messageOf(err).replaceAll(botToken, '…')}). Try again.`) })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => undefined) }
}

async function write({ path, botToken, body }: { path: string; botToken: string; body: unknown }): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.discordApi}${path}`, { method: 'POST', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
      .catch((err: unknown) => { throw new HttpError(502, `Discord didn't answer (${messageOf(err).replaceAll(botToken, '…')}). Try again.`) })
    if (res.ok) return res.json().catch(() => undefined)
    const failure = z.safeParse(Failure, await res.json().catch(() => undefined)).data
    const wait = (failure?.retry_after ?? Number(res.headers.get('retry-after') ?? 1)) * 1000
    if (res.status === 429 && attempt < RETRIES && wait <= MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      continue
    }
    if (res.status === 429) throw new HttpError(429, 'Discord is rate limiting the bot. Try again in a minute.')
    if (res.status === 401) throw new HttpError(400, 'Discord didn\'t accept the bot token. Reset it on the Bot page and connect Discord again.')
    if (res.status === 403 || res.status === 404) throw new HttpError(400, `The bot can't post there (${failure?.message ?? `HTTP ${res.status}`}). In Discord, open the channel's settings, then Permissions, and let the bot send messages.`)
    throw new HttpError(502, `Discord refused the message (${failure?.message ?? `HTTP ${res.status}`}). Try again.`)
  }
}

async function created(answer: Promise<unknown>): Promise<string> {
  const parsed = z.safeParse(Created, await answer)
  if (!parsed.success) throw new HttpError(502, 'Discord took the message but didn\'t say where it went. Check the channel.')
  return parsed.data.id
}

export function split(text: string): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > MAX_LENGTH) {
    const window = rest.slice(0, MAX_LENGTH)
    const at = [window.lastIndexOf('\n'), window.lastIndexOf(' ')].find((index) => index > MAX_LENGTH / 2) ?? MAX_LENGTH
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  return [...parts, rest]
}

type GuildChannel = z.infer<typeof GuildChannel>

function basePermissions({ guildId, roles, mine }: { guildId: string; roles: { id: string; permissions: string }[]; mine: string[] }): bigint {
  return roles.filter((role) => role.id === guildId || mine.includes(role.id)).reduce((all, role) => all | BigInt(role.permissions), 0n)
}

function isPrivate({ guildId, channel }: { guildId: string; channel: GuildChannel }): boolean {
  const everyone = channel.permission_overwrites.find((each) => each.id === guildId)
  return !!everyone && (BigInt(everyone.deny) & VIEW_CHANNEL) !== 0n
}

function canView({ guildId, base, mine, userId, channel }: { guildId: string; base: bigint; mine: string[]; userId: string; channel: GuildChannel }): boolean {
  if (base & ADMINISTRATOR) return true
  const apply = (now: bigint, overwrites: z.infer<typeof Overwrite>[]) => {
    const deny = overwrites.reduce((all, each) => all | BigInt(each.deny), 0n)
    const allow = overwrites.reduce((all, each) => all | BigInt(each.allow), 0n)
    return (now & ~deny) | allow
  }
  const of = (match: (each: z.infer<typeof Overwrite>) => boolean) => channel.permission_overwrites.filter(match)
  const everyone = apply(base, of((each) => each.id === guildId))
  const roles = apply(everyone, of((each) => each.type === 0 && mine.includes(each.id)))
  return (apply(roles, of((each) => each.type === 1 && each.id === userId)) & VIEW_CHANNEL) !== 0n
}
