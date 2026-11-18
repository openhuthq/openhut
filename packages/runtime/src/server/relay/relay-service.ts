import { request, type Server } from 'node:http'
import { hostname } from 'node:os'
import { Readable, duplexPair } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import * as z from 'zod/mini'
import { connect, serve, TunnelError, type TunnelRequest } from '@openhut/tunnel'
import { Access, verify } from '@openhut/common/access/access.ts'
import { accessService } from '../access/access-service.ts'
import { invitationService } from '../access/invitation-service.ts'
import { config } from '../platform/config.ts'
import { emit, log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { computerId, registerToken, relayKey } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { tagDevice } from '../team/identity.ts'

const NULL_BODY = new Set([204, 205, 304])
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding'])
const JoinCode = z.object({ c: z.string(), k: z.string(), o: z.string(), s: z.string(), r: z.string() })
const JOIN_WINDOW_MS = 5 * 60_000
const FIRST_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const CLOSED_BY_COMPUTER = 4003

export const relayService = {
  async start({ server }: { server: Server }): Promise<{ close: () => void } | undefined> {
    if (!config.relayUrl) return undefined
    const served = serve({
      relayUrl: config.relayUrl,
      computerId,
      registerToken,
      key: relayKey,
      device: (key) => accessService.device(key),
      invited: (input) => invitationService.invited(input),
      handle: (input) => handle({ server, ...input }),
    })
    if (config.join && !settings.access()) await join(config.join).catch((err: unknown) => log.error({ event: 'relay.join_failed', reason: messageOf(err) }))
    return served
  },

  handle,
  join,
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
      await accessService.put({ access: access.data, local: true })
      emit({ name: 'relay.joined', target: { type: 'computer', id: c, version: access.data.version } })
      return access.data
    }
    if (tunnel.failure && tunnel.failure.code !== CLOSED_BY_COMPUTER) throw tunnel.failure
    return failed('The computer closed the invitation before the owner decided.')
  } finally {
    tunnel.close()
  }
}
