import { createHash } from 'node:crypto'
import { request, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { Readable, duplexPair } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import WebSocket, { type RawData } from 'ws'
import { serve, sessions, type ComputerKey, type Handlers, type SocketPeer, type TunnelRequest, type TunnelSocketRequest } from '@openhut/tunnel'
import { boxKey } from '@openhut/common/vault/vault.ts'
import { keysService } from '../cloud/keys-service.ts'
import { config } from '../platform/config.ts'
import { listen, log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { memberOf, tagDevice } from '../team/identity.ts'
import { tailnetLink, type TailnetLink } from './tailnet-link.ts'

const NULL_BODY = new Set([204, 205, 304])
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding'])
const SYNC_MS = 10_000

let relay: { close: () => void } | undefined
let tailnet: TailnetLink | undefined
let handlers: Handlers | undefined
let syncing: Promise<void> | undefined

export const relayService = {
  async start({ server }: { server: Server }): Promise<void> {
    handlers = {
      listed: (key) => !!memberOf(key),
      handle: (input) => handle({ server, ...input }),
      socket: (input) => socket({ server, ...input }),
    }
    if (config.tailnetPort) await listenOnTailnet(handlers)
    listen(({ name }) => { if (name.startsWith('cloud.')) void relayService.sync() })
    setInterval(() => void relayService.sync(), SYNC_MS).unref()
    await relayService.sync()
  },

  sync(): Promise<void> {
    syncing ??= turn().finally(() => { syncing = undefined })
    return syncing
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
}

export async function tunnelKey(): Promise<ComputerKey> {
  return boxKey((await keysService.device()).secret)
}

export function relayIdOf(key: Uint8Array): string {
  return createHash('sha256').update(key).digest('hex')
}

async function turn(): Promise<void> {
  const wanted = !!handlers && !!config.relayUrl && !!keysService.session()
  if (wanted && !relay && handlers && config.relayUrl) {
    const key = await tunnelKey()
    relay = serve({ relayUrl: config.relayUrl, computerId: relayIdOf(key.publicKey), token: () => keysService.token(), key, ...handlers })
    log.info({ event: 'relay.on' })
  }
  if (!wanted && relay) {
    relay.close()
    relay = undefined
    log.info({ event: 'relay.off' })
  }
}

async function listenOnTailnet(input: Handlers): Promise<void> {
  try {
    tailnet = await tailnetLink({ host: config.host, port: config.tailnetPort, open: sessions({ ...input, key: await tunnelKey() }) })
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
