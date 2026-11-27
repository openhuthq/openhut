import { createServer, type IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { Agent, setGlobalDispatcher, type Dispatcher } from 'undici'

export const GUILD = '900000000000000001'
export const CHANNEL = '900000000000000010'
export const BOT = '1100000000000000001'
export const TOKEN = `${Buffer.from(BOT).toString('base64')}.fake.token`
export const BAD_TOKEN = `${Buffer.from(BOT).toString('base64')}.bad.token`
let counter = 0n
export const nextId = (): string => String((BigInt(Date.now() - 1420070400000) << 22n) | (counter++ % 4096n))

export const sent: { channel: string; content: string }[] = []
export const typing: string[] = []
export const renamed: { id: string; name: string }[] = []
export const identified: string[] = []
const threads = new Map<string, string>()
const sockets = new Set<WebSocket>()
let seq = 0

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) as Record<string, unknown> : {}
}

const dispatch = (t: string, d: unknown) => { for (const socket of sockets) socket.send(JSON.stringify({ op: 0, t, s: ++seq, d })) }
const channelOf = (id: string) => threads.has(id)
  ? { id, type: 11, guild_id: GUILD, parent_id: threads.get(id), name: `thread ${id}`, thread_metadata: { archived: false, auto_archive_duration: 1440, locked: false, archive_timestamp: new Date().toISOString() }, owner_id: BOT }
  : { id, type: 0, guild_id: GUILD, name: 'general', position: 0, permission_overwrites: [] }

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/api(\/v\d+)?/, '')
  const body = req.method === 'GET' ? {} : await bodyOf(req)
  const json = (status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
  if (req.headers.authorization !== `Bot ${TOKEN}`) return json(401, { message: '401: Unauthorized', code: 0 })
  if (path === '/gateway/bot') return json(200, { url: `ws://127.0.0.1:${port()}`, shards: 1, session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 } })
  if (path === '/users/@me') return json(200, { id: BOT, username: 'pulse', discriminator: '0', bot: true })
  if (path === '/users/@me/guilds') return json(200, [])
  let m = /^\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(path)
  if (m && req.method === 'POST') {
    threads.set(m[2], m[1])
    dispatch('THREAD_CREATE', { ...channelOf(m[2]), newly_created: true })
    return json(201, channelOf(m[2]))
  }
  m = /^\/channels\/(\d+)\/typing$/.exec(path)
  if (m) {
    typing.push(m[1])
    return res.writeHead(204).end()
  }
  m = /^\/channels\/(\d+)\/messages$/.exec(path)
  if (m && req.method === 'POST') {
    sent.push({ channel: m[1], content: String(body.content ?? '') })
    return json(200, { id: nextId(), channel_id: m[1], content: body.content, author: { id: BOT, username: 'pulse', bot: true }, timestamp: new Date().toISOString() })
  }
  if (m) return json(200, [])
  m = /^\/channels\/(\d+)$/.exec(path)
  if (m && req.method === 'PATCH') renamed.push({ id: m[1], name: String(body.name) })
  if (m) return json(200, channelOf(m[1]))
  json(404, { message: `The fake Discord has no ${req.method} ${path}.` })
})

new WebSocketServer({ server }).on('connection', (socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } }))
  socket.on('message', (raw) => {
    const packet = JSON.parse(String(raw)) as { op: number; d?: { token?: string } }
    if (packet.op === 1) socket.send(JSON.stringify({ op: 11 }))
    if (packet.op !== 2) return
    identified.push(String(packet.d?.token))
    dispatch('READY', { v: 10, user: { id: BOT, username: 'pulse', discriminator: '0', bot: true }, guilds: [{ id: GUILD, unavailable: true }], session_id: 'fake', resume_gateway_url: `ws://127.0.0.1:${port()}`, application: { id: BOT, flags: 0 } })
    dispatch('GUILD_CREATE', { id: GUILD, name: 'Fake', unavailable: false, owner_id: '1', roles: [{ id: GUILD, name: '@everyone', permissions: '0', position: 0, color: 0, hoist: false, managed: false, mentionable: false }], channels: [channelOf(CHANNEL)], threads: [], members: [], emojis: [], stickers: [], features: [], member_count: 2, joined_at: new Date().toISOString(), large: false, voice_states: [], presences: [], stage_instances: [], guild_scheduled_events: [] })
  })
})

export const port = (): number => (server.address() as { port: number }).port
export const connected = (): number => sockets.size

export async function listen(): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  class ToFake extends Agent {
    override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
      return super.dispatch(String(options.origin).includes('discord.com') ? { ...options, origin: `http://127.0.0.1:${port()}` } : options, handler)
    }
  }
  setGlobalDispatcher(new ToFake())
  return `http://127.0.0.1:${port()}/api/v10`
}

export const close = (): Promise<void> => {
  for (const socket of sockets) socket.terminate()
  return new Promise((resolve) => server.close(() => resolve()))
}

export function say({ text, channel = CHANNEL, mention = false, author = 'ana' }: { text: string; channel?: string; mention?: boolean; author?: string }): string {
  const id = nextId()
  dispatch('MESSAGE_CREATE', {
    id, channel_id: channel, guild_id: GUILD, type: 0, tts: false, pinned: false, flags: 0, mention_everyone: false, mention_roles: [], attachments: [], embeds: [], components: [],
    author: { id: author === 'ana' ? '700000000000000001' : '700000000000000002', username: author, global_name: author === 'ana' ? 'Ana' : 'Ben', discriminator: '0' },
    member: { roles: [], joined_at: new Date().toISOString() },
    content: mention ? `<@${BOT}> ${text}` : text, timestamp: new Date().toISOString(),
    mentions: mention ? [{ id: BOT, username: 'pulse', discriminator: '0', bot: true }] : [],
  })
  return id
}
