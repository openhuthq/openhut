import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Browser, BrowserInputAccepted, type BrowserInputEvent } from '@openhut/common/agents/browser.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { request } from '@/lib/api-client'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Me } from '@openhut/common/team/team.ts'
import { browserPath, useAgent, useAgents, useHoldBrowser } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { on } from '@/lib/openhut'
import { ME_KEY } from '@/lib/query-keys'

const FLUSH_MS = 16
const MOVE_MS = 33
const BATCH = 64
const ACTIONS_SHOWN = 12
const RIPPLE_MS = 600
const HOLD_IDLE_S = 120
const PAGE = 'flex h-dvh flex-col overflow-hidden bg-sidebar [--bar:56px] [--chrome:79px] [--gap:20px] [--pad:20px] [--side:288px] [--win:min(var(--pw),calc(100vw_-_var(--side)_-_var(--gap)_-_2_*_var(--pad)),calc((100dvh_-_var(--bar)_-_2_*_var(--pad)_-_var(--chrome))_*_var(--ar)))] mobile:h-auto mobile:min-h-dvh mobile:overflow-visible mobile:[--win:calc(100vw_-_2_*_var(--pad))]'
const ACTION_WORDS: Record<string, string> = { navigate: 'Opened', click: 'Clicked', fill: 'Filled in', type: 'Typed', press: 'Pressed a key', scroll: 'Scrolled', snapshot: 'Read the page', gettext: 'Read the text', url: 'Checked the address', title: 'Checked the title', screenshot: 'Took a screenshot', back: 'Went back', forward: 'Went forward', reload: 'Reloaded' }

export function BrowserPage({ agentId }: { agentId: string }) {
  const listed = !!useAgents().data
  const me = useQuery({ queryKey: [...ME_KEY, 'on', agentId], queryFn: () => request({ schema: Me, path: on({ agentId, path: '/api/me' }) }), enabled: listed })
  if (!me.data) return <div className={PAGE}><ErrorNote className="mx-6 mt-4" message={me.error?.message} /></div>
  return <BrowserView me={me.data} agentId={agentId} />
}

function BrowserView({ me, agentId }: { me: Me; agentId: string }) {
  const agent = useAgent(agentId)
  const live = useLive(agentId)
  const hold = useHoldBrowser(agentId)
  const mine = live.heldBy === me.user.email
  const sendInput = useInput(agentId, mine)
  const send = (event: BrowserInputEvent) => { sendInput(event); setLastInput(Date.now()) }
  const screen = useRef<HTMLDivElement>(null)
  const movedAt = useRef(0)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const [shape, setShape] = useState({ width: 1280, height: 800 })
  const [lastInput, setLastInput] = useState(0)
  const [now, setNow] = useState(Date.now())
  const name = agent.data?.name ?? 'The agent'
  useEffect(() => { document.title = `${name}'s browser · OpenHut` }, [name])
  useEffect(() => {
    if (!mine) return
    screen.current?.focus({ preventScroll: true })
    setLastInput(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [mine])
  useEffect(() => {
    if (!mine) return
    const handBack = () => void fetch(`${browserPath(agentId)}/hold`, { method: 'DELETE', keepalive: true })
    window.addEventListener('pagehide', handBack)
    return () => window.removeEventListener('pagehide', handBack)
  }, [agentId, mine])
  if (agent.error) return <div className={PAGE}><ErrorNote className="mx-6 mt-4" message={agent.error.message} /></div>
  const point = (event: MouseEvent<HTMLElement> | WheelEvent<HTMLElement>) => {
    const picture = screen.current?.querySelector('img')
    const box = (picture ?? event.currentTarget).getBoundingClientRect()
    const scale = picture?.naturalWidth ? picture.naturalWidth / box.width : 1
    return { x: Math.max(0, Math.round((event.clientX - box.left) * scale)), y: Math.max(0, Math.round((event.clientY - box.top) * scale)), left: event.clientX - box.left, top: event.clientY - box.top }
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
    send({ type: 'mouse', action, x, y, button: (['left', 'middle', 'right'] as const)[event.button] ?? 'left', modifiers: modifiersOf(event) })
  }
  const key = (action: 'down' | 'up') => (event: KeyboardEvent<HTMLElement>) => {
    if (!mine) return
    event.preventDefault()
    send({ type: 'key', action, key: event.key, code: event.code, modifiers: modifiersOf(event) })
  }
  const heldByOther = live.heldBy && !mine
  const address = addressOf(live.page.url)
  const left = Math.max(0, HOLD_IDLE_S - Math.round((now - lastInput) / 1000))
  const toggle = () => hold.mutate(!mine, { onError: toastError })
  return <div className={PAGE} style={{ '--pw': `${shape.width}px`, '--ar': shape.width / shape.height } as CSSProperties}>
    <header className="h-(--bar) shrink-0 border-b border-hair bg-card px-(--pad)">
      <div className="mx-auto flex h-full max-w-[calc(var(--win)+var(--side)+var(--gap))] min-w-0 items-center gap-2.5 mobile:max-w-none">
        <a className="inline-flex shrink-0 items-center gap-1 text-[13px] text-mute no-underline hover:text-ink mobile:hidden [&_svg]:rotate-180" href={`/agents/${encodeURIComponent(agentId)}`} title={`Back to ${name}`}>{ICONS.chev}{name}</a>
        <Separator orientation="vertical" className="h-5 mobile:hidden" />
        {agent.data && <Face agent={agent.data} size={32} />}
        <h1 className="m-0 min-w-0 truncate text-[15px] font-semibold">{name}'s browser</h1>
        {mine ? <Badge variant="pill-ink">You're in control</Badge>
          : <Badge variant="pill"><i className={cn('size-[7px] rounded-full', live.state === 'live' ? 'animate-[blive_1.6s_ease-in-out_infinite] bg-fail' : 'bg-mute-2')} />{live.state === 'live' ? 'Live' : live.state === 'closed' ? 'No page open' : 'Connecting'}</Badge>}
        <span className="flex-1" />
        <Button type="button" variant="primary" disabled={!!heldByOther || hold.isPending || (!mine && live.state !== 'live')} onClick={toggle}>{mine ? `Hand back to ${name}` : 'Take over'}</Button>
      </div>
    </header>
    <main className="grid min-h-0 flex-1 grid-cols-[var(--win)_var(--side)] content-center justify-center gap-(--gap) p-(--pad) mobile:grid-cols-[minmax(0,1fr)] mobile:content-start">
      <section className={cn('flex w-full flex-col self-start overflow-hidden rounded-lg border bg-card', mine ? 'border-ink shadow-[0_0_0_1px_var(--ink),0_12px_40px_oklch(0%_0_0/.12)]' : 'border-mid shadow-[0_1px_2px_oklch(0%_0_0/.06),0_12px_40px_oklch(0%_0_0/.08)]')} aria-label={`${name}'s browser window`}>
        <div className="flex h-11 min-w-0 shrink-0 items-center border-b border-hair bg-card px-2">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg bg-soft px-2.5 font-mono text-[12.5px]" title={live.page.title}>
            <span className={cn('inline-flex shrink-0', address.secure ? 'text-pass' : 'text-mute')} aria-label={address.secure ? 'Secure connection' : undefined}>{address.secure ? ICONS.lock : ICONS.globe}</span>
            <span className="truncate"><span className="text-ink">{address.host || 'about:blank'}</span><span className="text-mute">{address.rest}</span></span>
          </div>
          {live.state === 'live' && <span className="shrink-0 pl-2.5 font-mono text-xs text-mute tabular-nums" title="Frames a second the live view is getting">{live.fps} fps</span>}
        </div>
        <div className={cn('flex h-[34px] min-w-0 shrink-0 items-center border-b px-3 text-[12.5px]', mine ? 'border-b-transparent bg-ink font-medium text-white shadow-[inset_0_-1px_0_oklch(100%_0_0/.18)]' : 'border-hair bg-soft text-mute')} role="status">
          <span className="truncate">{mine ? `${name} is paused · hands back in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} if idle`
            : `${name} is driving. Take over to use the page yourself.`}</span>
        </div>
        <div className={cn('relative bg-tint leading-[0] outline-none', mine ? 'cursor-crosshair' : 'cursor-not-allowed')} ref={screen} tabIndex={mine ? 0 : -1} role="application" aria-label={`${name}'s page`}
          onMouseDown={mouse('down')} onMouseUp={mouse('up')} onMouseMove={mouse('move')} onContextMenu={(event) => mine && event.preventDefault()}
          onWheel={(event) => { if (!mine) return; const { x, y } = point(event); send({ type: 'mouse', action: 'wheel', x, y, deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }) }}
          onKeyDown={key('down')} onKeyUp={key('up')}
          onPaste={(event) => { if (!mine) return; event.preventDefault(); for (const char of event.clipboardData.getData('text').slice(0, 500)) { send({ type: 'key', action: 'down', key: char }); send({ type: 'key', action: 'up', key: char }) } }}>
          {live.state === 'live' && <img className="block h-auto w-full select-none" src={`${browserPath(agentId)}/frames?c=${live.connection}`} alt={`The page ${name} has open: ${live.page.title}`} draggable={false}
            onLoad={(event) => { const { naturalWidth: width, naturalHeight: height } = event.currentTarget; if (width && height && (width !== shape.width || height !== shape.height)) setShape({ width, height }) }} />}
          {live.state !== 'live' && <div className="flex aspect-(--ar) w-full flex-col items-center justify-center gap-3 p-6 text-center leading-[1.5] text-mute">
            {agent.data && <Face agent={agent.data} size={48} />}
            <p className="m-0 max-w-[36ch]">{live.state === 'closed' ? `${name} hasn't opened a page yet. This view starts as soon as it does.` : 'Connecting to the browser…'}</p>
          </div>}
          {ripples.map((ripple) => <span key={ripple.id} className="pointer-events-none absolute -mt-3.5 -ml-3.5 size-7 animate-[bripple_.6s_ease-out_forwards] rounded-full border-2 border-ink" style={{ left: ripple.x, top: ripple.y }} />)}
        </div>
      </section>
      <aside className="flex min-h-0 min-w-0 flex-col gap-3 self-stretch mobile:self-start">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hair bg-card">
          <h3 className="m-0 border-b border-hair px-3.5 pt-3 pb-2.5 text-[13px] font-semibold text-ink">Activity</h3>
          {live.actions.length ? <ol className="m-0 min-h-0 list-none overflow-auto p-0">{live.actions.map((action, index) => <li className="flex min-w-0 flex-col gap-0.5 border-t border-hair px-3.5 py-2.5 text-[13px] first:border-t-0" key={`${action.at}-${index}`}>
            <span className="flex justify-between gap-2"><b className="font-medium">{ACTION_WORDS[action.action] ?? action.action}</b><span className="text-xs text-mute">{ago(action.at)}</span></span>
            {action.url && <span className="truncate text-xs text-mute" title={action.url}>{addressOf(action.url).host}{addressOf(action.url).rest}</span>}
          </li>)}</ol> : <div className="flex flex-col gap-2.5 p-3.5">
            {['', 'w-[72%]', 'w-[48%]'].map((width) => <span key={width} className={cn('h-2.5 rounded-md bg-soft', width)} />)}
            <p className="mt-1 mb-0 text-[12.5px]/[1.5] text-mute">Nothing yet. {name}'s clicks and page loads appear here.</p>
          </div>}
        </div>
        <p className="m-0 rounded-lg border border-hair bg-card px-3.5 py-3 text-[12.5px]/[1.5] text-body"><b>Take over</b> to log in or get past a check. {name} can't act until you hand back, or after 2 minutes without input.</p>
        {live.error && <ErrorNote className="mx-6 mt-4" message={live.error} />}
      </aside>
    </main>
  </div>
}

function addressOf(url: string) {
  try {
    const parsed = new URL(url)
    return { secure: parsed.protocol === 'https:', host: parsed.host, rest: `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}` }
  } catch {
    return { secure: false, host: url, rest: '' }
  }
}

function useLive(agentId: string) {
  const [connection, setConnection] = useState(0)
  const [page, setPage] = useState({ url: '', title: '' })
  const [heldBy, setHeldBy] = useState<string | null>(null)
  const [actions, setActions] = useState<{ action: string; url: string; at: number }[]>([])
  const [state, setState] = useState<'connecting' | 'live' | 'closed'>('connecting')
  const [error, setError] = useState<string>()
  const [, setTicks] = useState(0)
  const frames = useRef(0)
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const tick = setInterval(() => setTicks((n) => n + 1), 10_000)
    const count = setInterval(() => { setFps(frames.current); frames.current = 0 }, 1000)
    return () => { clearInterval(tick); clearInterval(count) }
  }, [])
  useEffect(() => {
    const source = new EventSource(`${browserPath(agentId)}/stream`)
    const on = (event: string, handle: (data: unknown) => void) => source.addEventListener(event, (message) => handle(JSON.parse(message.data)))
    on('frame', () => { frames.current += 1; setState('live') })
    on('page', (data) => setPage(data as typeof page))
    on('hold', (data) => setHeldBy((data as { heldBy: string | null }).heldBy))
    on('action', (data) => setActions((known) => [{ ...(data as { action: string; url: string }), at: Date.now() }, ...known].slice(0, ACTIONS_SHOWN)))
    on('closed', () => setState('closed'))
    source.onopen = () => { setError(undefined); setConnection((n) => n + 1) }
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return
      setState('closed')
      request({ schema: Browser, path: browserPath(agentId) }).then(() => setError('The live view stopped. Reload the page to try again.'), (failure: Error) => setError(failure.message))
    }
    return () => source.close()
  }, [agentId])
  return { connection, page, heldBy, actions, state, error, fps }
}

function useInput(agentId: string, enabled: boolean) {
  const queue = useRef<BrowserInputEvent[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = () => {
    timer.current = undefined
    while (queue.current.length) {
      const events = queue.current.splice(0, BATCH)
      void request({ schema: BrowserInputAccepted, path: `${browserPath(agentId)}/input`, method: 'POST', body: { events } }).catch(toastError)
    }
  }
  return (event: BrowserInputEvent) => {
    if (!enabled) return
    queue.current.push(event)
    timer.current ??= setTimeout(flush, FLUSH_MS)
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
