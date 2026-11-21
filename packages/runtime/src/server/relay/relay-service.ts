import { request, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { hostname } from 'node:os'
import { Readable, duplexPair } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import WebSocket, { type RawData } from 'ws'
import * as z from 'zod/mini'
import { connect, serve, sessions, TunnelError, type Handlers, type SocketPeer, type TunnelRequest, type TunnelSocketRequest } from '@openhut/tunnel'
import { Access, verify } from '@openhut/common/access/access.ts'
import { accessService } from '../access/access-service.ts'
import { invitationService } from '../access/invitation-service.ts'
import { config } from '../platform/config.ts'
import { emit, listen, log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { computerId, registerToken, relayKey, relayKeyHex } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { tagDevice } from '../team/identity.ts'
import { tailnetLink, type TailnetLink } from './tailnet-link.ts'

const NULL_BODY = new Set([204, 205, 304])
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding'])
const JoinCode = z.object({ c: z.string(), k: z.string(), o: z.string(), s: z.string(), r: z.string() })
const JOIN_WINDOW_MS = 5 * 60_000
const FIRST_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const CLOSED_BY_COMPUTER = 4003
const SYNC_MS = 60_000

let relay: { close: () => void } | undefined
let tailnet: TailnetLink | undefined
let handlers: Handlers | undefined

export const relayService = {
  async start({ server }: { server: Server }): Promise<void> {
    handlers = {
      device: (key) => accessService.device(key),
      invited: (input) => invitationService.invited(input),
      handle: (input) => handle({ server, ...input }),
      socket: (input) => socket({ server, ...input }),
    }
    if (config.tailnetPort) await listenOnTailnet(handlers)
    listen(({ name }) => { if (/^(invitation|access)\./.test(name)) relayService.sync() })
    setInterval(relayService.sync, SYNC_MS).unref()
    relayService.sync()
    const code = config.join
    if (code && config.relayUrl && code !== settings.joinTried()) await settings.setJoinTried(code).then(() => join(code)).catch((err: unknown) => log.error({ event: 'relay.join_failed', reason: messageOf(err) }))
  },

  sync(): void {
    if (!handlers || !config.relayUrl) return
    const wanted = needed()
    if (wanted && !relay) {
      relay = serve({ relayUrl: config.relayUrl, computerId, registerToken, key: relayKey, ...handlers })
      log.info({ event: 'relay.on' })
    }
    if (!wanted && relay) {
      relay.close()
      relay = undefined
      log.info({ event: 'relay.off' })
    }
  },

  stop(): void {
    relay?.close()
    relay = undefined
    tailnet?.close()
    tailnet = undefined
    handlers = undefined
  },

  state(): { relay: boolean; tailnet: { port: number; open: number } | null } {
    return { relay: !!relay, tailnet: tailnet?.state() ?? null }
  },

  handle,
  socket,
  join,
}

function needed(): boolean {
  if (config.join || invitationService.waiting()) return true
  if (settings.removedClients().length) return true
  return (settings.access() ? accessService.get().clients.length : 0) > 1
}

async function listenOnTailnet(input: Handlers): Promise<void> {
  try {
    tailnet = await tailnetLink({ host: config.host, port: config.tailnetPort, open: sessions({ ...input, key: relayKey, strangers: 'drop' }) })
    log.info({ event: 'relay.tailnet_listening', port: config.tailnetPort })
  } catch (err) {
    log.error({ event: 'relay.tailnet_failed', port: config.tailnetPort, reason: messageOf(err) })
  }
}

async function handle({ server, device, method, path, headers, body }: TunnelRequest & { server: Server }): Promise<Response> {
  const [inner, outer] = duplexPair()
  server.emit('connection', tagDevice({ conn: inner, key: device }))
  return new Promise((resolve, reject) => {
    const outgoing = request({ createConnection: () => outer, method, path, headers: { ...headers, connection: 'close' } }, (res) => {
      const status = res.statusCode ?? 502
      const answer = new Headers()
      for (const [name, value] of Object.entries(res.headers)) if (value !== undefined && !HOP_BY_HOP.has(name)) answer.set(name, String(value))
      resolve(new Response(NULL_BODY.has(status) ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers: answer }))
    })
    outgoing.on('error', reject)
    pipeline(Readable.fromWeb(body as NodeReadableStream<Uint8Array>), outgoing).catch(reject)
  })
}

function socket({ server, device, path, headers, send, close }: TunnelSocketRequest & { server: Server }): Promise<SocketPeer> {
  const [inner, outer] = duplexPair()
  server.emit('connection', tagDevice({ conn: inner, key: device }))
  const ws = new WebSocket(`ws://openhut${path}`, { createConnection: () => outer as Socket, headers })
  ws.on('message', (data, binary) => send(binary ? bytes(data) : new TextDecoder().decode(bytes(data))))
  ws.on('close', (code, reason) => close({ code, reason: String(reason) }))
  ws.on('error', () => undefined)
  return new Promise((resolve) => ws.once('open', () => resolve({ send: (data) => ws.send(data), close: () => ws.close() })))
}

function bytes(data: RawData): Uint8Array {
  return Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data)
}

async function join(code: string): Promise<Access | undefined> {
  const parsed = z.parse(JoinCode, Object.fromEntries(new URL(code).searchParams))
  const until = Date.now() + JOIN_WINDOW_MS
  for (let wait = FIRST_RETRY_MS; ; wait = Math.min(wait * 2, MAX_RETRY_MS)) {
    try {
      return await joinOnce(parsed)
    } catch (err) {
      if (!(err instanceof TunnelError) || err.code === CLOSED_BY_COMPUTER || Date.now() + wait > until) throw err
      log.warn({ event: 'relay.join_retry', computer: parsed.c, reason: err.message, retryInMs: wait })
      await sleep(wait)
    }
  }
}

async function joinOnce({ c, k, o, s, r }: z.infer<typeof JoinCode>): Promise<Access | undefined> {
  const name = hostname()
  const tunnel = await connect({ relayUrl: r, computer: { id: c, key: k }, key: relayKey, invitation: { secret: s, name, kind: 'computer', computer: { id: computerId, name } } })
  log.info({ event: 'relay.joining', computer: c, digits: tunnel.digits })
  const failed = (reason: string): undefined => {
    log.error({ event: 'relay.join_failed', computer: c, reason })
  }
  try {
    for await (const message of tunnel.control) {
      if (message.type === 'declined') return failed('The owner declined this computer, or the invitation ran out.')
      if (message.type !== 'accepted') continue
      const access = z.safeParse(Access, message.access)
      if (!access.success || access.data.owner !== o || !await verify(access.data)) return failed('The list that came back isn\'t signed by the owner in the code.')
      if (accessService.holding(relayKeyHex)?.signature !== access.data.signature) await accessService.put({ access: access.data, local: true })
      emit({ name: 'relay.joined', target: { type: 'computer', id: c, version: access.data.version } })
      return access.data
    }
    if (tunnel.failure && tunnel.failure.code !== CLOSED_BY_COMPUTER) throw tunnel.failure
    return failed('The computer closed the invitation before the owner decided.')
  } finally {
    tunnel.close()
  }
}
