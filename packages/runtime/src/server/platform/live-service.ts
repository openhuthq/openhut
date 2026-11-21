import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import { LIVE_BEAT_MS, type LiveEvent } from '@openhut/common/live.ts'
import { who } from '../team/identity.ts'
import { listen, log, type AppEvent } from './events.ts'
import { HttpError, messageOf } from './http-error.ts'

const PUSHED = new Set(['agent', 'thread', 'channel', 'connection', 'grant', 'skill', 'memory', 'provider', 'admin', 'routine', 'cloud', 'presence'])
const MAX_BUFFERED = 1 << 20
const MAX_REASON = 120
const followers = new Map<WebSocket, { answered: boolean }>()

export const liveService = {
  async follow({ socket, req }: { socket: WebSocket; req: FastifyRequest }): Promise<void> {
    try {
      if (!sameOrigin(req)) throw new HttpError(403, 'Only the OpenHut app can follow this computer.')
      await who(req)
    } catch (error) {
      return socket.close(4000 + (error instanceof HttpError ? error.status : 500), messageOf(error).slice(0, MAX_REASON))
    }
    if (socket.readyState !== socket.OPEN) return
    const follower = { answered: true }
    followers.set(socket, follower)
    socket.on('message', () => { follower.answered = true })
    socket.on('close', (code) => {
      followers.delete(socket)
      log.info({ event: 'live.closed', code, followers: followers.size })
    })
    log.info({ event: 'live.opened', followers: followers.size })
    send({ socket, event: computerEvent('hello') })
  },

  followed(): boolean {
    return followers.size > 0
  },
}

export function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

listen(({ name, target }: AppEvent) => {
  if (!target || !PUSHED.has(target.type) || !followers.size) return
  const event: LiveEvent = { object: 'event', type: name, data: { object: target.type, id: target.id } }
  for (const socket of followers.keys()) send({ socket, event })
})

setInterval(() => {
  for (const [socket, follower] of followers) {
    if (!follower.answered) {
      socket.terminate()
      continue
    }
    follower.answered = false
    send({ socket, event: computerEvent('beat') })
  }
}, LIVE_BEAT_MS).unref()

function send({ socket, event }: { socket: WebSocket; event: LiveEvent }): void {
  if (socket.readyState !== socket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED) return socket.terminate()
  socket.send(JSON.stringify(event))
}

function computerEvent(type: 'hello' | 'beat'): LiveEvent {
  return { object: 'event', type, data: { object: 'computer', id: 'this' } }
}
