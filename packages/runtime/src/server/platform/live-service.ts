import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { LIVE_BEAT_MS, LiveUp, type LiveDown, type LiveEvent } from '@openhut/common/live.ts'
import { who, type Caller } from '../team/identity.ts'
import { agentService } from '../agents/agent-service.ts'
import { liveThreads, type Viewer } from '../threads/live.ts'
import { threadService } from '../threads/thread-service.ts'
import { db } from './db.ts'
import { listen, log, type AppEvent } from './events.ts'
import { HttpError, messageOf } from './http-error.ts'

const PUSHED = new Set(['computer', 'agent', 'thread', 'channel', 'connection', 'grant', 'skill', 'memory', 'provider', 'admin', 'routine', 'ask'])
const MAX_BUFFERED = 1 << 20
const MAX_REASON = 120
const CANT_SEE = 'That chat doesn\'t exist, or you can\'t see it.'
const followers = new Map<WebSocket, { answered: boolean }>()

export const liveService = {
  async follow({ socket, req }: { socket: WebSocket; req: FastifyRequest }): Promise<void> {
    let caller: Caller
    let person: Viewer['person']
    try {
      if (!sameOrigin(req)) throw new HttpError(403, 'Only the OpenHut app can follow this computer.')
      caller = await who(req)
      person = await personOf(caller)
    } catch (error) {
      return socket.close(4000 + (error instanceof HttpError ? error.status : 500), messageOf(error).slice(0, MAX_REASON))
    }
    if (socket.readyState !== socket.OPEN) return
    const follower = { answered: true }
    followers.set(socket, follower)
    const viewer: Viewer = { person, send: (message) => send({ socket, event: message }) }
    socket.on('message', (data) => {
      follower.answered = true
      const up = z.safeParse(LiveUp, parseJson(String(data))).data
      if (up) void onUp({ socket, caller, viewer, up })
    })
    socket.on('close', (code) => {
      followers.delete(socket)
      liveThreads.drop(socket)
      log.info({ event: 'live.closed', code, followers: followers.size })
    })
    log.info({ event: 'live.opened', followers: followers.size })
    send({ socket, event: computerEvent('hello') })
  },

  followed(): boolean {
    return followers.size > 0
  },
}

async function onUp({ socket, caller, viewer, up }: { socket: WebSocket; caller: Caller; viewer: Viewer; up: LiveUp }): Promise<void> {
  if (up.type === 'leave') return liveThreads.leave({ thread: up.thread, key: socket })
  if (up.type === 'typing') return liveThreads.typing({ thread: up.thread, key: socket, on: up.on })
  const seen = await threadService.agentIdOf(up.thread).then((id) => agentService.requireVisible({ actor: caller, id })).then(() => true, () => false)
  if (!seen) return viewer.send({ type: 'error', thread: up.thread, message: CANT_SEE })
  if (socket.readyState === socket.OPEN) liveThreads.join({ thread: up.thread, key: socket, viewer })
}

async function personOf(caller: Caller): Promise<Viewer['person']> {
  const row = await db.selectFrom('person').select('name').where('id', '=', caller.id).executeTakeFirst()
  return { id: caller.id, email: caller.email, name: row?.name || caller.email }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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

function send({ socket, event }: { socket: WebSocket; event: LiveEvent | LiveDown }): void {
  if (socket.readyState !== socket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED) return socket.terminate()
  socket.send(JSON.stringify(event))
}

function computerEvent(type: 'hello' | 'beat'): LiveEvent {
  return { object: 'event', type, data: { object: 'computer', id: 'this' } }
}
