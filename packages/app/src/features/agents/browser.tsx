import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { ArrowExpand01Icon, Cancel01Icon, Cursor01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { I, TINY_ICON } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useLive } from '@/features/agents/browser-live'
import { Face } from '@/features/agents/face'
import { cn } from '@/lib/utils'

const PREVIEW_FPS = 2
const LIVE_FPS = 30
const MOVE_MS = 33
const RIPPLE_MS = 600
const HOLD_IDLE_S = 120
const ACTION_WORDS: Record<string, string> = { navigate: 'Opened', click: 'Clicked', fill: 'Filled in', type: 'Typed', press: 'Pressed a key', scroll: 'Scrolled', snapshot: 'Read the page', gettext: 'Read the text', url: 'Checked the address', title: 'Checked the title', screenshot: 'Took a screenshot', back: 'Went back', forward: 'Went forward', reload: 'Reloaded' }

export function BrowserPip({ agent, hidden, onClose, onBrowsing }: { agent: Agent; hidden: boolean; onClose: () => void; onBrowsing: (browsing: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useLive({ path: livePath({ agentId: agent.id, fps: PREVIEW_FPS }), canvas })
  const [moved, setMoved] = useState({ x: 0, y: 0 })
  const grab = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => onBrowsing(live.busy), [live.busy, onBrowsing])
  useEffect(() => () => onBrowsing(false), [onBrowsing])
  const address = addressOf(live.page.url)
  const last = live.actions[0]
  const doing = last ? `${ACTION_WORDS[last.action] ?? last.action}${live.page.title ? ` · ${live.page.title}` : ''}` : live.page.title || address.host
  return <section aria-label={`${agent.name}'s browser`} hidden={hidden || !live.busy} style={{ translate: `${moved.x}px ${moved.y}px` }}
    className="absolute right-6 bottom-[104px] z-20 w-80 overflow-hidden rounded-xl bg-card shadow-[0_16px_40px_-12px_oklch(0%_0_0/.32),0_2px_6px_oklch(0%_0_0/.08)]">
    <div className="flex h-8 cursor-grab touch-none items-center gap-2 bg-[oklch(98.4%_0_0)] pr-1 pl-2.5 active:cursor-grabbing"
      onPointerDown={(event) => { if (event.target instanceof Element && event.target.closest('a,button')) return; event.currentTarget.setPointerCapture(event.pointerId); grab.current = { x: event.clientX - moved.x, y: event.clientY - moved.y } }}
      onPointerMove={(event) => { if (grab.current) setMoved({ x: event.clientX - grab.current.x, y: event.clientY - grab.current.y }) }}
      onPointerUp={() => { grab.current = null }} onPointerCancel={() => { grab.current = null }}>
      <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-ink text-[9.5px] font-bold text-white uppercase">{address.host.replace(/^www\./, '').charAt(0)}</span>
      <span className="min-w-0 truncate text-[12.5px] font-medium">{address.host.replace(/^www\./, '')}</span>
      <i aria-label="Live" className="size-1.5 shrink-0 rounded-full bg-pass" />
      <span className="ml-auto flex gap-0.5">
        <a href={agentPath({ agentId: agent.id, dialog: 'browser' })} aria-label="Open full size" title="Open full size" className={cn(TINY_ICON, 'size-6')}><I icon={ArrowExpand01Icon} size={14} /></a>
        <Button type="button" variant="bare" aria-label="Close browser" title="Close" className={cn(TINY_ICON, 'size-6')} onClick={onClose}><I icon={Cancel01Icon} size={14} /></Button>
      </span>
    </div>
    <canvas ref={canvas} className="block h-[158px] w-full bg-tint object-cover object-top" aria-label={`The page ${agent.name} has open: ${live.page.title}`} />
    <div className="flex h-[34px] min-w-0 items-center gap-2 px-3 text-[12px] text-body">
      <I icon={Cursor01Icon} size={13} className="text-mute" /><span className="truncate">{doing}</span>
    </div>
  </section>
}

export function BrowserDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useLive({ path: livePath({ agentId: agent.id, fps: LIVE_FPS }), canvas })
  const screen = useRef<HTMLDivElement>(null)
  const movedAt = useRef(0)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const [lastInput, setLastInput] = useState(0)
  const [now, setNow] = useState(Date.now())
  const mine = live.mine
  const name = agent.name
  useEffect(() => {
    if (!mine) return
    screen.current?.focus({ preventScroll: true })
    setLastInput(Date.now())
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [mine])
  const point = (event: MouseEvent<HTMLElement> | WheelEvent<HTMLElement>) => {
    const box = (canvas.current ?? event.currentTarget).getBoundingClientRect()
    const width = Number(canvas.current?.dataset.viewWidth) || canvas.current?.width
    const scale = width ? width / box.width : 1
    return { x: Math.max(0, Math.round((event.clientX - box.left) * scale)), y: Math.max(0, Math.round((event.clientY - box.top) * scale)), left: event.clientX - box.left, top: event.clientY - box.top }
  }
  const touched = () => {
    setLastInput(Date.now())
    setNow(Date.now())
  }
  const mouse = (action: 'down' | 'up' | 'move') => (event: MouseEvent<HTMLElement>) => {
    if (!mine) return
    event.preventDefault()
    if (action === 'down') screen.current?.focus({ preventScroll: true })
    if (action === 'move' && Date.now() - movedAt.current < MOVE_MS) return
    if (action === 'move') movedAt.current = Date.now()
    const { x, y, left, top } = point(event)
    if (action === 'down') {
      const ripple = { id: Date.now(), x: left, y: top }
      setRipples((known) => [...known, ripple])
      setTimeout(() => setRipples((known) => known.filter((each) => each.id !== ripple.id)), RIPPLE_MS)
    }
    live.mouse({ action, x, y, button: (['left', 'middle', 'right'] as const)[event.button] ?? 'left', modifiers: modifiersOf(event) })
    touched()
  }
  const key = (action: 'down' | 'up') => (event: KeyboardEvent<HTMLElement>) => {
    if (!mine) return
    event.preventDefault()
    live.key({ action, key: event.key, code: event.code, modifiers: modifiersOf(event) })
    touched()
  }
  const address = addressOf(live.page.url)
  const left = Math.max(0, HOLD_IDLE_S - Math.round((now - lastInput) / 1000))
  return <Dialog label={`${name}'s browser`} onClose={onClose} onEscape={mine ? () => undefined : undefined} className="flex h-[min(860px,calc(100vh-48px))] w-[min(1320px,calc(100vw-48px))] flex-col overflow-hidden">
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-hair px-4">
      <Face agent={agent} size={30} />
      <DialogTitle className="min-w-0 truncate text-[15px] font-semibold">{name}'s browser</DialogTitle>
      {mine ? <Badge variant="pill-ink">You're in control</Badge>
        : <Badge variant="pill"><i className={cn('size-[7px] rounded-full', live.state === 'live' ? 'animate-[blive_1.6s_ease-in-out_infinite] bg-fail' : 'bg-mute-2')} />{live.state === 'live' ? 'Live' : live.state === 'closed' ? 'No page open' : 'Connecting'}</Badge>}
      <span className="flex-1" />
      <Button type="button" variant="primary" disabled={!mine && live.state !== 'live'} onClick={() => live.hold(!mine)}>{mine ? `Hand back to ${name}` : 'Take over'}</Button>
      <Button type="button" size="icon-sm" aria-label="Close" title={mine ? 'Close (hands back)' : 'Close (Esc)'} onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] gap-4 bg-sidebar p-4 max-[900px]:grid-cols-[minmax(0,1fr)]">
      <section className={cn('flex min-h-0 flex-col self-start overflow-hidden rounded-lg border bg-card', mine ? 'border-ink shadow-[0_0_0_1px_var(--ink),0_12px_40px_oklch(0%_0_0/.12)]' : 'border-mid shadow-[0_1px_2px_oklch(0%_0_0/.06),0_12px_40px_oklch(0%_0_0/.08)]')} aria-label={`${name}'s browser window`}>
        <div className="flex h-11 min-w-0 shrink-0 items-center border-b border-hair bg-card px-2">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg bg-soft px-2.5 font-mono text-[12.5px]" title={live.page.title}>
            <span className={cn('inline-flex shrink-0', address.secure ? 'text-pass' : 'text-mute')} aria-label={address.secure ? 'Secure connection' : undefined}>{address.secure ? ICONS.lock : ICONS.globe}</span>
            <span className="truncate"><span className="text-ink">{address.host || 'about:blank'}</span><span className="text-mute">{address.rest}</span></span>
          </div>
        </div>
        <div className={cn('flex h-[34px] min-w-0 shrink-0 items-center border-b px-3 text-[12.5px]', mine ? 'border-b-transparent bg-ink font-medium text-white' : 'border-hair bg-soft text-mute')} role="status">
          <span className="truncate">{mine ? `${name} is paused · hands back in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} if idle` : live.held ? `Someone in another window is using ${name}'s browser. Take over to use it here.` : `${name} is driving. Take over to use the page yourself.`}</span>
        </div>
        <div className={cn('relative min-h-0 bg-tint leading-[0] outline-none', mine ? 'cursor-crosshair' : 'cursor-not-allowed')} ref={screen} tabIndex={mine ? 0 : -1} role="application" aria-label={`${name}'s page`}
          onMouseDown={mouse('down')} onMouseUp={mouse('up')} onMouseMove={mouse('move')} onContextMenu={(event) => mine && event.preventDefault()}
          onWheel={(event) => { if (!mine) return; const { x, y } = point(event); live.mouse({ action: 'wheel', x, y, deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }); touched() }}
          onKeyDown={key('down')} onKeyUp={key('up')}
          onPaste={(event) => { if (!mine) return; event.preventDefault(); for (const char of event.clipboardData.getData('text').slice(0, 500)) { live.key({ action: 'down', key: char }); live.key({ action: 'up', key: char }) } touched() }}>
          <canvas ref={canvas} hidden={live.state !== 'live'} className="mx-auto block h-auto max-h-[calc(min(860px,100vh_-_48px)_-_170px)] w-auto max-w-full select-none" aria-label={`The page ${name} has open: ${live.page.title}`} />
          {live.state !== 'live' && <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 p-6 text-center leading-[1.5] text-mute">
            <Face agent={agent} size={48} />
            <p className="m-0 max-w-[36ch]">{live.state === 'closed' ? `${name} hasn't opened a page yet. This view starts as soon as it does.` : 'Connecting to the browser…'}</p>
          </div>}
          {ripples.map((ripple) => <span key={ripple.id} className="pointer-events-none absolute -mt-3.5 -ml-3.5 size-7 animate-[bripple_.6s_ease-out_forwards] rounded-full border-2 border-ink" style={{ left: ripple.x, top: ripple.y }} />)}
        </div>
      </section>
      <aside className="flex min-h-0 min-w-0 flex-col gap-3 max-[900px]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hair bg-card">
          <h3 className="m-0 border-b border-hair px-3.5 pt-3 pb-2.5 text-[13px] font-semibold text-ink">Activity</h3>
          {live.actions.length ? <ol className="m-0 min-h-0 list-none overflow-auto p-0">{live.actions.map((action, index) => <li className="flex min-w-0 flex-col gap-0.5 border-t border-hair px-3.5 py-2.5 text-[13px] first:border-t-0" key={`${action.at}-${index}`}>
            <span className="flex justify-between gap-2"><b className="font-medium">{ACTION_WORDS[action.action] ?? action.action}</b><span className="text-xs text-mute">{ago(action.at)}</span></span>
            {action.url && <span className="truncate text-xs text-mute" title={action.url}>{addressOf(action.url).host}{addressOf(action.url).rest}</span>}
          </li>)}</ol> : <p className="m-0 p-3.5 text-[12.5px]/[1.5] text-mute">Nothing yet. {name}'s clicks and page loads appear here.</p>}
        </div>
        <p className="m-0 rounded-lg border border-hair bg-card px-3.5 py-3 text-[12.5px]/[1.5] text-body"><b>Take over</b> to log in or get past a check. {name} can't act until you hand back, close this, or after 2 minutes without input.</p>
        {live.error && <ErrorNote message={live.error} />}
      </aside>
    </div>
  </Dialog>
}

function livePath({ agentId, fps }: { agentId: string; fps: number }) {
  return `/api/browsers/${encodeURIComponent(agentId)}/live?fps=${fps}`
}

function addressOf(url: string) {
  try {
    const parsed = new URL(url)
    return { secure: parsed.protocol === 'https:', host: parsed.host, rest: `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}` }
  } catch {
    return { secure: false, host: url, rest: '' }
  }
}

function ago(at: number) {
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  return `${Math.round(seconds / 60)} min ago`
}

function modifiersOf(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}
