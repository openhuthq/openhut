import * as z from 'zod/mini'
import type { Conversation } from '@openhut/common/channels/channel.ts'
import { config } from '../../platform/config.ts'
import { log } from '../../platform/events.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'

const Failure = z.object({ ok: z.literal(false), error: z.string() })
const Ok = z.object({ ok: z.literal(true) })
const AuthTest = z.object({ ok: z.literal(true), team: z.string(), user: z.string(), bot_id: z.optional(z.string()) })
const BotInfo = z.object({ ok: z.literal(true), bot: z.object({ app_id: z.string() }) })
const RawConversation = z.object({
  id: z.string(), name: z.optional(z.string()), is_private: z.optional(z.boolean()), is_mpim: z.optional(z.boolean()), is_member: z.optional(z.boolean()),
  num_members: z.optional(z.number()), is_ext_shared: z.optional(z.boolean()), is_shared: z.optional(z.boolean()),
})
const ConversationPage = z.object({
  ok: z.literal(true),
  channels: z.array(z.unknown()),
  response_metadata: z.optional(z.object({ next_cursor: z.optional(z.string()) })),
})
export const SlackSecrets = z.object({ botToken: z.string(), appToken: z.string() })
const DM_SCOPES = ['im:history']
const TYPES = ['public_channel,private_channel', 'mpim']
const PAGES = 20

export const slack = {
  async verify({ botToken, appToken, configToken, icon, agentName }: { botToken: string; appToken: string; configToken?: string; icon?: string; agentName: string }): Promise<string> {
    const bot = await checkBot(botToken)
    const app = await call({ method: 'apps.connections.open', token: appToken, schema: Ok })
    if (!app.ok) throw new HttpError(400, `Slack didn't accept the app-level token (${app.error}). Make one with the connections:write scope.`, { param: 'appToken' })
    if (!configToken || !icon) return `${bot.team} · @${bot.user}`
    const info = await call({ method: 'bots.info', token: botToken, params: { bot: bot.bot_id ?? '' }, schema: BotInfo })
    if (!info.ok) throw new HttpError(400, `Slack didn't say which app the bot token belongs to (${info.error}). Copy it again from OAuth & Permissions.`, { param: 'botToken' })
    const form = new FormData()
    form.set('app_id', info.data.bot.app_id)
    form.set('file', new Blob([Buffer.from(icon, 'base64')], { type: 'image/png' }), 'icon.png')
    const set = await call({ method: 'apps.icon.set', token: configToken, form, schema: Ok })
    if (!set.ok) throw new HttpError(400, `Slack didn't give ${agentName} its face (${set.error}). Generate a new configuration token and paste it again.`, { param: 'configToken' })
    return `${bot.team} · @${bot.user}`
  },

  async conversations({ botToken }: { botToken: string }): Promise<Conversation[]> {
    const pages = await Promise.all(TYPES.map((types) => listConversations({ botToken, types })))
    return pages.flat().flatMap(conversationOf).sort((a, b) => a.name.localeCompare(b.name))
  },

  async enter({ botToken, ids, agentName }: { botToken: string; ids: string[]; agentName: string }): Promise<void> {
    if (!ids.length) return
    const bot = await checkBot(botToken)
    const known = new Map((await slack.conversations({ botToken })).map((each) => [each.id, each]))
    for (const id of ids) {
      const conversation = known.get(id)
      if (!conversation) throw new HttpError(400, `${agentName} can't see that channel in Slack. If it's private, type /invite @${bot.user} in it first.`, { param: 'allowed' })
      if (conversation.joined) continue
      if (conversation.type !== 'public') throw new HttpError(400, `Add @${bot.user} to ${conversation.name} in Slack first.`, { param: 'allowed' })
      const joined = await call({ method: 'conversations.join', token: botToken, params: { channel: id }, schema: Ok })
      if (!joined.ok) throw new HttpError(400, `${agentName} couldn't join #${conversation.name} (${joined.error}). Type /invite @${bot.user} in it instead.`, { param: 'allowed' })
    }
  },

  async greet({ botToken, ids, agentName }: { botToken: string; ids: string[]; agentName: string }): Promise<string[]> {
    const failed: string[] = []
    for (const id of ids) {
      const sent = await call({ method: 'chat.postMessage', token: botToken, params: { channel: id, text: `Hi, I'm ${agentName}. Mention me and I'll answer in a thread.` }, schema: Ok })
      if (!sent.ok) failed.push(`${id}: ${sent.error}`)
    }
    return failed
  },

  async postCard({ botToken, channel, threadTs, blocks, text }: { botToken: string; channel: string; threadTs?: string; blocks: object[]; text: string }): Promise<boolean> {
    const sent = await call({ method: 'chat.postMessage', token: botToken, params: { channel, text, blocks: JSON.stringify(blocks), ...(threadTs && { thread_ts: threadTs }) }, schema: Ok })
    if (!sent.ok) log.warn({ event: 'slack.card_refused', error: sent.error })
    return sent.ok
  },

  env({ botToken, appToken, channels }: { botToken: string; appToken: string; channels: string[] }): string[] {
    if (!channels.length) return []
    return [`SLACK_BOT_TOKEN=${botToken}`, `SLACK_APP_TOKEN=${appToken}`, 'SLACK_ALLOW_ALL_USERS=true', `SLACK_ALLOWED_CHANNELS=${channels.join(',')}`, `SLACK_HOME_CHANNEL=${channels[0]}`]
  },

  yaml: 'slack:\n  require_mention: true\n  unauthorized_dm_behavior: ignore\n  gateway_restart_notification: false\n',
}

async function listConversations({ botToken, types }: { botToken: string; types: string }): Promise<unknown[]> {
  const found: unknown[] = []
  let cursor = ''
  for (let page = 0; page < PAGES; page++) {
    const res = await call({ method: 'conversations.list', token: botToken, params: { types, exclude_archived: 'true', limit: '200', cursor }, schema: ConversationPage })
    if (!res.ok) throw new HttpError(502, `Slack didn't list the workspace's channels (${res.error}). Try again.`)
    found.push(...res.data.channels)
    cursor = res.data.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return found
}

function conversationOf(raw: unknown): Conversation[] {
  const parsed = z.safeParse(RawConversation, raw)
  if (!parsed.success || !parsed.data.name) return []
  const each = parsed.data
  const type = typeOf(each)
  if (type !== 'public' && !each.is_member) return []
  const name = type === 'group' ? groupName(each.name ?? '') : each.name ?? ''
  return [{ id: each.id, object: 'conversation', name, type, shared: !!(each.is_ext_shared || each.is_shared), members: each.num_members ?? 0, joined: !!each.is_member }]
}

function typeOf(each: z.infer<typeof RawConversation>): Conversation['type'] {
  if (each.is_mpim) return 'group'
  return each.is_private ? 'private' : 'public'
}

function groupName(name: string): string {
  return name.replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').join(', ')
}

async function checkBot(botToken: string): Promise<z.infer<typeof AuthTest>> {
  const bot = await call({ method: 'auth.test', token: botToken, schema: AuthTest })
  if (!bot.ok) throw new HttpError(400, `Slack didn't accept the bot token (${bot.error}). Copy it again from OAuth & Permissions.`, { param: 'botToken' })
  if (bot.scopes.some((scope) => DM_SCOPES.includes(scope))) {
    throw new HttpError(400, `This Slack app takes direct messages, so anyone in ${bot.data.team} could talk to the agent. Disconnect Slack and set it up again: the new app answers only in the channels you pick.`, { param: 'botToken' })
  }
  return bot.data
}

async function call<T>({ method, token, params = {}, form, schema }: { method: string; token: string; params?: Record<string, string>; form?: FormData; schema: z.ZodMiniType<T> }): Promise<{ ok: true; data: T; scopes: string[] } | { ok: false; error: string }> {
  const res = await fetch(`${config.slackApi}/${method}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form ?? new URLSearchParams(params), signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => { throw new HttpError(502, `Slack didn't answer (${messageOf(err)}). Try again.`) })
  const body: unknown = await res.json().catch(() => undefined)
  const ok = z.safeParse(schema, body)
  if (ok.success) return { ok: true, data: ok.data, scopes: (res.headers.get('x-oauth-scopes') ?? '').split(',').map((scope) => scope.trim()) }
  const failure = z.safeParse(Failure, body)
  return { ok: false, error: failure.success ? failure.data.error : `HTTP ${res.status}` }
}
