import { Chat, ConsoleLogger, type Logger, type Message } from 'chat'
import { DiscordAdapter } from '@chat-adapter/discord'
import { createPostgresState } from '@chat-adapter/state-pg'
import type pg from 'pg'
import { discord, DiscordSecrets } from '../integrations/discord/discord.ts'
import { config } from '../platform/config.ts'
import { db, pglite } from '../platform/db.ts'
import { listen, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { unseal } from '../platform/secrets.ts'
import { threadService, type ThreadPlace } from '../threads/thread-service.ts'
import { chat } from './index.ts'

const SYNC_MS = 10_000
const TYPING_MS = 8_000
const FOREVER_MS = 2 ** 31 - 1
const CATCH_UP_MS = 24 * 60 * 60_000
const quiet = new ConsoleLogger('warn')
const CONNECTING = 'Connecting to Discord…'
const running = new Map<string, Bot>()
const failed = new Map<string, string>()
let expected = new Set<string>()
let syncing: Promise<void> = Promise.resolve()

class Discord extends DiscordAdapter {
  allowed = new Set<string>()

  protected override createDiscordThread(channelId: string, messageId: string): ReturnType<DiscordAdapter['createDiscordThread']> {
    if (!this.allowed.has(channelId)) throw new HttpError(403, 'The agent doesn\'t answer in that channel.')
    return super.createDiscordThread(channelId, messageId)
  }
}

export const bots = {
  start(): void {
    listen(({ name }) => { if (/^(agent|channel)\./.test(name)) void bots.sync() })
    setInterval(() => void bots.sync(), SYNC_MS).unref()
    void bots.sync()
  },

  sync(): Promise<void> {
    syncing = syncing.then(sync).catch((err: unknown) => log.warn({ event: 'chat.bots_sync_failed', error: messageOf(err) }))
    return syncing
  },

  offline(agentId: string): string | undefined {
    if (!expected.has(agentId) || running.get(agentId)?.connected) return undefined
    return failed.get(agentId) ?? CONNECTING
  },

  async typing(threadId: string): Promise<() => void> {
    const { agentId, place } = await threadService.whereOf(threadId)
    const bot = place?.platform === 'discord' ? running.get(agentId) : undefined
    if (!bot || !place) return () => undefined
    const tick = () => void bot.adapter.startTyping(sdkId(place)).catch(() => undefined)
    tick()
    const timer = setInterval(tick, TYPING_MS)
    return () => clearInterval(timer)
  },
}

async function sync(): Promise<void> {
  const rows = await db.selectFrom('channel').innerJoin('agent', 'agent.id', 'channel.agent_id').select(['channel.agent_id', 'channel.secrets', 'channel.allowed'])
    .where('channel.kind', '=', 'discord').where('channel.status', '=', 'connected').where('agent.wanted', '=', 'running').execute()
  const wanted = new Map(rows.map((row) => [row.agent_id, { token: DiscordSecrets.parse(JSON.parse(unseal(row.secrets))).botToken, allowed: row.allowed.split(',').filter(Boolean) }]))
  expected = new Set(wanted.keys())
  for (const [agentId, bot] of running) if (wanted.get(agentId)?.token !== bot.token) stop(agentId)
  for (const [agentId, { token, allowed }] of wanted) {
    const bot = running.get(agentId) ?? await start({ agentId, token })
    bot.adapter.allowed = new Set(allowed)
  }
}

async function start({ agentId, token }: { agentId: string; token: string }): Promise<Bot> {
  const halt = new AbortController()
  const bot = { token, halt, connected: false } as Bot
  const adapter = new Discord({ botToken: token, applicationId: discord.appIdOf(token), webhookVerifier: () => false, apiUrl: config.discordApi, logger: watch({ agentId, bot }), userName: agentId })
  bot.adapter = adapter
  const state = createPostgresState({ client: { query: (text: string, params?: unknown[]) => pglite.query(text, params), end: async () => undefined } as unknown as pg.Pool, keyPrefix: agentId, logger: quiet })
  const sdk = new Chat({ userName: agentId, adapters: { discord: adapter }, state, concurrency: 'concurrent', logger: quiet })
  const hear = async (id: string, message: Message) => {
    const { guildId, channelId, threadId } = adapter.decodeThreadId(id)
    if (adapter.isDM(id) || !adapter.allowed.has(channelId) || message.author.isBot === true) return
    const place: ThreadPlace = { platform: 'discord', chat_id: channelId, ...threadId && { thread_id: threadId }, chat_name: '', url: `https://discord.com/channels/${guildId}/${threadId ?? channelId}` }
    const text = message.text.replace(new RegExp(`<@!?${adapter.botUserId}>`, 'g'), '').trim()
    const title = text.slice(0, 100) || 'Discord'
    if (threadId === message.id && !await threadService.known({ agentId, place })) void adapter.setThreadTitle(id, title).catch(() => undefined)
    await chat.receive({ agentId, place, title, said: [{ ref: message.id, at: message.metadata.dateSent, author: message.author.fullName || message.author.userName, text }] })
  }
  sdk.onNewMention((thread, message) => hear(thread.id, message))
  sdk.onNewMessage(async (thread, message) => {
    const { channelId, threadId } = adapter.decodeThreadId(thread.id)
    if (threadId && await threadService.known({ agentId, place: { platform: 'discord', chat_id: channelId, thread_id: threadId, chat_name: '' } })) await hear(thread.id, message)
  })
  await sdk.initialize()
  running.set(agentId, bot)
  // ponytail: one Discord gateway per bot in the API process, no sharding; move to a worker if a bot outgrows one shard
  await adapter.startGatewayListener({ waitUntil: (task) => void task.finally(() => { if (running.get(agentId) === bot) running.delete(agentId) }) }, FOREVER_MS, halt.signal)
  void catchUp({ agentId, adapter, hear }).catch((err: unknown) => log.warn({ event: 'chat.catch_up_failed', agent: agentId, error: messageOf(err) }))
  return bot
}

function stop(agentId: string): void {
  running.get(agentId)?.halt.abort()
  running.delete(agentId)
}

// ponytail: catch-up reads threads heard from in the last day; widen CATCH_UP_MS if bots stay down longer
async function catchUp({ agentId, adapter, hear }: { agentId: string; adapter: Discord; hear: (id: string, message: Message) => Promise<void> }): Promise<void> {
  for (const { place, ref } of await threadService.lastHeard({ agentId, channel: 'discord', since: Date.now() - CATCH_UP_MS })) {
    const id = sdkId(place)
    for (const message of (await adapter.fetchMessages(id, { cursor: ref, direction: 'forward' })).messages) {
      if (!message.author.isMe) await hear(id, message)
    }
  }
}

function watch({ agentId, bot }: { agentId: string; bot: Bot }): Logger {
  const logger: Logger = {
    child: () => logger,
    debug: () => undefined,
    info: (message) => {
      if (message !== 'Discord Gateway connected') return
      bot.connected = true
      failed.delete(agentId)
      log.info({ event: 'chat.bot_connected', agent: agentId })
    },
    warn: (message, ...args) => quiet.warn(message, ...args),
    error: (message, ...args) => {
      const error = JSON.stringify(args)
      if (message === 'Discord Gateway listener error') failed.set(agentId, reasonOf(error))
      log.warn({ event: 'chat.bot_error', agent: agentId, message, error: error.slice(0, 500) })
    },
  }
  return logger
}

function reasonOf(error: string): string {
  if (/disallowed intents/i.test(error)) return 'Turn on Message Content Intent on the Bot page in Discord.'
  if (/token/i.test(error)) return 'Discord didn\'t accept the bot token. Connect Discord again with a new token.'
  return 'Can\'t reach Discord. OpenHut keeps trying.'
}

const sdkId = (place: ThreadPlace): string => `discord:_:${place.chat_id}${place.thread_id ? `:${place.thread_id}` : ''}`

type Bot = { token: string; adapter: Discord; halt: AbortController; connected: boolean }
