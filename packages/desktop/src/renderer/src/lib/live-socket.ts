import { Capacitor } from '@capacitor/core'

export type Channel = { send: (line: string) => void; close: () => void }
type Bridge = { browserLive?: (path: string, onLine: (line: string) => void, onClose: (code: number, reason: string) => void) => Channel }

export function openChannel({ computer, path, onLine, onClose }: { computer: string; path: string; onLine: (line: string) => void; onClose: (code: number, reason: string) => void }): Channel {
  const bridge: Bridge | undefined = Reflect.get(window, 'openhut')
  if (bridge?.browserLive) return bridge.browserLive(`/c/${computer}${path}`, onLine, onClose)
  if (Capacitor.isNativePlatform()) {
    const opening = import('@/lib/phone').then(({ phoneSocket }) => phoneSocket({ computer, path }))
    opening.then((socket) => {
      socket.onmessage = ({ data }) => onLine(String(data))
      socket.onclose = ({ code, reason }) => onClose(code, reason)
    }, () => onClose(1006, ''))
    return { send: (line) => void opening.then((socket) => socket.send(line), () => undefined), close: () => void opening.then((socket) => socket.close(), () => undefined) }
  }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`)
  ws.onmessage = ({ data }) => onLine(String(data))
  ws.onclose = ({ code, reason }) => onClose(code, reason)
  return { send: (line) => ws.readyState === WebSocket.OPEN && ws.send(line), close: () => ws.close() }
}
