import { desktop } from './desktop.ts'

export type Channel = { send: (line: string) => void; close: () => void }

export function openChannel({ path, onLine, onClose }: { path: string; onLine: (line: string) => void; onClose: (code: number, reason: string) => void }): Channel {
  if (desktop?.browserLive) return desktop.browserLive(path, onLine, onClose)
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`)
  ws.onmessage = ({ data }) => onLine(String(data))
  ws.onclose = ({ code, reason }) => onClose(code, reason)
  return { send: (line) => ws.readyState === WebSocket.OPEN && ws.send(line), close: () => ws.close() }
}
