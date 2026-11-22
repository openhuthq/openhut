import { useEffect, useRef, useState, type RefObject } from 'react'
import { openChannel, type Channel } from '../../lib/live-socket.ts'

const RETRY_MS = 3000
const ACTIONS_SHOWN = 12
const MOUSE_EVENTS = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved', wheel: 'mouseWheel' } as const
const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
}
const CTRL_OR_META = 2 | 4

export type Mouse = { action: keyof typeof MOUSE_EVENTS; x: number; y: number; button?: 'left' | 'middle' | 'right'; deltaX?: number; deltaY?: number; modifiers?: number }
export type Key = { action: 'down' | 'up'; key: string; code?: string; modifiers?: number }
export type Action = { action: string; url: string; at: number }

export function useLive({ computer, path, canvas }: { computer: string; path: string; canvas: RefObject<HTMLCanvasElement | null> }) {
  const [state, setState] = useState<'connecting' | 'live' | 'closed'>('connecting')
  const [page, setPage] = useState({ url: '', title: '' })
  const [held, setHeld] = useState(false)
  const [mine, setMine] = useState(false)
  const [actions, setActions] = useState<Action[]>([])
  const [error, setError] = useState<string>()
  const [rate, setRate] = useState(0)
  const channel = useRef<Channel>(undefined)
  const frames = useRef(0)
  useEffect(() => {
    const count = setInterval(() => { setRate(frames.current); frames.current = 0 }, 1000)
    return () => clearInterval(count)
  }, [])
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const pending = new Map<string, Omit<Action, 'at'>>()
    const connect = () => {
      const open = openChannel({
        computer,
        path,
        onLine: (line) => {
          const message = parse(line)
          if (message?.type === 'frame' && typeof message.data === 'string') {
            const ack = () => open.send(JSON.stringify({ type: 'ack', seq: message.seq }))
            void paint({ canvas: canvas.current, data: message.data, viewWidth: viewWidthOf(message.metadata) }).finally(ack)
            frames.current += 1
            setState('live')
            setError(undefined)
          }
          if (message?.type === 'tabs') setPage(activeTab(message.tabs))
          if (message?.type === 'url' && typeof message.url === 'string') setPage((known) => ({ ...known, url: message.url as string }))
          if (message?.type === 'hold') {
            const hold = holdOf(message)
            setHeld(hold.held)
            setMine(hold.mine)
          }
          if (message?.type === 'closed') setState('closed')
          if (message?.type === 'command' && typeof message.action === 'string') pending.set(String(message.id), { action: message.action, url: typeof message.url === 'string' ? message.url : '' })
          if (message?.type === 'result') {
            const action = pending.get(String(message.id))
            pending.delete(String(message.id))
            if (action) setActions((known) => [{ ...action, at: Date.now() }, ...known].slice(0, ACTIONS_SHOWN))
          }
        },
        onClose: (code, reason) => {
          channel.current = undefined
          setHeld(false)
          setMine(false)
          setState((known) => known === 'live' ? 'connecting' : 'closed')
          if (code >= 4000) setError(reason || 'Couldn\'t open the live view. Close this and open it again.')
          else if (!stopped) retry = setTimeout(connect, RETRY_MS)
        },
      })
      channel.current = open
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      channel.current?.close()
    }
  }, [computer, path, canvas])
  const send = (message: object) => channel.current?.send(JSON.stringify(message))
  return { state, page, held, mine, actions, error, fps: rate, hold: (held: boolean) => send({ type: 'hold', held }), mouse: (event: Mouse) => send(mouseInput(event)), key: (event: Key) => send(keyInput(event)) }
}

export function holdOf(message: Record<string, unknown>) {
  const held = message.held === true
  return { held, mine: typeof message.mine === 'boolean' ? message.mine : held }
}

export function mouseInput(event: Mouse) {
  const pressing = event.action === 'down' || event.action === 'up'
  return {
    type: 'input_mouse', eventType: MOUSE_EVENTS[event.action], x: event.x, y: event.y, button: pressing ? event.button ?? 'left' : 'none',
    clickCount: pressing ? 1 : 0, deltaX: event.deltaX ?? 0, deltaY: event.deltaY ?? 0, modifiers: event.modifiers ?? 0,
  }
}

export function keyInput(event: Key) {
  const printable = [...event.key].length === 1 && !((event.modifiers ?? 0) & CTRL_OR_META)
  const text = event.action === 'down' ? (event.key === 'Enter' ? '\r' : printable ? event.key : undefined) : undefined
  const code = KEY_CODES[event.key] ?? ([...event.key].length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0)
  return {
    type: 'input_keyboard', eventType: event.action === 'down' ? 'keyDown' : 'keyUp', key: event.key, code: event.code ?? '', text,
    windowsVirtualKeyCode: code, modifiers: event.modifiers ?? 0,
  }
}

export function viewWidthOf(metadata: unknown): number | undefined {
  const width = typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'deviceWidth') : undefined
  return typeof width === 'number' && width > 0 ? width : undefined
}

async function paint({ canvas, data, viewWidth }: { canvas: HTMLCanvasElement | null; data: string; viewWidth?: number }) {
  if (!canvas) return
  if (viewWidth) canvas.dataset.viewWidth = String(viewWidth)
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: 'image/jpeg' }))
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) Object.assign(canvas, { width: bitmap.width, height: bitmap.height })
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : undefined
  } catch {
    return undefined
  }
}

function activeTab(tabs: unknown): { url: string; title: string } {
  const list = Array.isArray(tabs) ? tabs.map((tab: unknown) => (typeof tab === 'object' && tab !== null ? Object.fromEntries(Object.entries(tab)) : {})) : []
  const tab = list.find((each) => each.active === true) ?? list[0]
  return { url: typeof tab?.url === 'string' ? tab.url : '', title: typeof tab?.title === 'string' ? tab.title : '' }
}
