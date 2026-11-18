import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import { liveBrowser } from '../platform/agentd.ts'
import { emit } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { who } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

const MAX_LINE = 2048
const MAX_REASON = 120

export const browserService = {
  async live({ socket, req, agentId, fps }: { socket: WebSocket; req: FastifyRequest; agentId: string; fps: number }): Promise<void> {
    try {
      if (!sameOrigin(req)) throw new HttpError(403, 'Only the OpenHut app can open an agent\'s browser.')
      const actor = await who(req)
      const row = await agentService.requireEditable({ actor, id: agentId })
      if (!row.web_browser) throw new HttpError(409, `${row.name}'s browser is off. Switch Browser on in ${row.name}'s settings first.`)
      const live = liveBrowser({ id: agentId, fps, onLine: (line) => socket.send(line), onEnd: () => socket.close() })
      socket.on('message', (data) => {
        const line = String(data)
        if (line.length > MAX_LINE) return socket.close(1009, 'That message is too long.')
        const held = /^\{"type":"hold","held":(true|false)\}$/.exec(line)?.[1]
        if (held) emit({ name: held === 'true' ? 'browser.held' : 'browser.released', actor, target: { type: 'agent', id: agentId, name: row.name } })
        live.send(line)
      })
      socket.on('close', () => live.close())
    } catch (error) {
      socket.close(4000 + (error instanceof HttpError ? error.status : 500), messageOf(error).slice(0, MAX_REASON))
    }
  },
}

function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}
