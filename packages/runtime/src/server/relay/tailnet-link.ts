import { WebSocketServer, type WebSocket } from 'ws'
import type { PipeSession, Pipe } from '@openhut/tunnel'

const MAX_FRAME = 1 << 20
const MAX_WAITING = 16
const MAX_OPEN = 64
const HANDSHAKE_MS = 10_000
const PING_MS = 30_000

export type TailnetLink = { close: () => void; state: () => { port: number; open: number } }

export async function tailnetLink({ host, port, open }: { host: string; port: number; open: (pipe: Pipe) => PipeSession }): Promise<TailnetLink> {
  const server = new WebSocketServer({ host, port, maxPayload: MAX_FRAME })
  const waiting = new Set<WebSocket>()
  const shaken = new Set<WebSocket>()
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.on('connection', (ws) => {
    if (shaken.size >= MAX_OPEN) return ws.close(1013, 'Too many sessions.')
    if (waiting.size >= MAX_WAITING) [...waiting][0]?.terminate()
    waiting.add(ws)
    let alive = true
    const late = setTimeout(() => ws.terminate(), HANDSHAKE_MS)
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, PING_MS)
    const session = open({
      send: (bytes) => {
        if (waiting.delete(ws)) {
          clearTimeout(late)
          shaken.add(ws)
        }
        ws.send(bytes)
      },
      close: () => ws.close(),
    })
    ws.on('pong', () => { alive = true })
    ws.on('message', (data, binary) => {
      if (binary) session.receive(Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data))
    })
    ws.on('close', () => {
      clearTimeout(late)
      clearInterval(ping)
      waiting.delete(ws)
      shaken.delete(ws)
      session.end()
    })
    ws.on('error', () => undefined)
  })
  return {
    close: () => {
      for (const ws of [...waiting, ...shaken]) ws.terminate()
      server.close()
    },
    state: () => ({ port, open: shaken.size }),
  }
}
