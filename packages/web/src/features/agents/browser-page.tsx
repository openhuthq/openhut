import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Browser, BrowserInputAccepted, type BrowserInputEvent } from '@openhut/common/agents/browser.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { request } from '@/lib/api-client'
import { toastError } from '@/lib/toast'
import { browserPath, useAgent, useHoldBrowser } from '@/features/agents/api'

const FLUSH_MS = 40
const MOVE_MS = 80
const BATCH = 64
const ACTIONS_SHOWN = 12
const RIPPLE_MS = 600
const HOLD_IDLE_S = 120
const ACTION_WORDS: Record<string, string> = { navigate: 'Opened', click: 'Clicked', fill: 'Filled in', type: 'Typed', press: 'Pressed a key', scroll: 'Scrolled', snapshot: 'Read the page', gettext: 'Read the text', url: 'Checked the address', title: 'Checked the title', screenshot: 'Took a screenshot', back: 'Went back', forward: 'Went forward', reload: 'Reloaded' }

export function BrowserPage({ me, agentId }: { me: Me; agentId: string }) {
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
  if (agent.error) return <div className="bpage"><ErrorNote message={agent.error.message} /></div>
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
  return <div className={mine ? 'bpage held' : 'bpage'} style={{ '--pw': `${shape.width}px`, '--ar': shape.width / shape.height } as CSSProperties}>
    <header className="bbar">
      <div className="bbar-in">
        <a className="bback" href={`/agents/${encodeURIComponent(agentId)}`} title={`Back to ${name}`}>{ICONS.chev}{name}</a>
        <span className="bvsep" />
        {agent.data && <Avatar id={agent.data.id} about={agent.data.instructions} size={24} />}
        <h1 className="ellip">{name}'s browser</h1>
        {mine ? <span className="bpill mine">You're in control</span>
          : heldByOther ? <span className="bpill mine">{live.heldBy} is in control</span>
          : <span className={`bpill ${live.state}`}><i />{live.state === 'live' ? 'Live' : live.state === 'closed' ? 'No page open' : 'Connecting'}</span>}
        <span className="bgrow" />
        <button type="button" className="btn primary" disabled={!!heldByOther || hold.isPending || (!mine && live.state !== 'live')} onClick={toggle}>{mine ? `Hand back to ${name}` : 'Take over'}</button>
      </div>
    </header>
    <main className="bstage">
      <section className="bwin" aria-label={`${name}'s browser window`}>
        <div className="bwin-url">
          <div className="burlfield" title={live.page.title}>
            <span className={address.secure ? 'bsecure' : 'bsecure off'} aria-label={address.secure ? 'Secure connection' : undefined}>{address.secure ? ICONS.lock : ICONS.globe}</span>
            <span className="ellip"><span className="bhost">{address.host || 'about:blank'}</span><span className="bpath">{address.rest}</span></span>
          </div>
        </div>
        <div className={mine ? 'bstrip held' : 'bstrip'} role="status">
          <span className="ellip">{mine ? `${name} is paused · hands back in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} if idle`
            : heldByOther ? `${live.heldBy} is using the page. ${name} is paused.` : `${name} is driving. Take over to use the page yourself.`}</span>
        </div>
        <div className="bscreen" ref={screen} tabIndex={mine ? 0 : -1} role="application" aria-label={`${name}'s page`}
          onMouseDown={mouse('down')} onMouseUp={mouse('up')} onMouseMove={mouse('move')} onContextMenu={(event) => mine && event.preventDefault()}
          onWheel={(event) => { if (!mine) return; const { x, y } = point(event); send({ type: 'mouse', action: 'wheel', x, y, deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }) }}
          onKeyDown={key('down')} onKeyUp={key('up')}
          onPaste={(event) => { if (!mine) return; event.preventDefault(); for (const char of event.clipboardData.getData('text').slice(0, 500)) { send({ type: 'key', action: 'down', key: char }); send({ type: 'key', action: 'up', key: char }) } }}>
          {live.frame ? <img src={`data:image/jpeg;base64,${live.frame.data}`} alt={`The page ${name} has open: ${live.page.title}`} draggable={false}
            onLoad={(event) => { const { naturalWidth: width, naturalHeight: height } = event.currentTarget; if (width && height && (width !== shape.width || height !== shape.height)) setShape({ width, height }) }} /> : <div className="bwait">
            {agent.data && <Avatar id={agent.data.id} about={agent.data.instructions} size={48} />}
            <p>{live.state === 'closed' ? `${name} hasn't opened a page yet. This view starts as soon as it does.` : 'Connecting to the browser…'}</p>
          </div>}
          {ripples.map((ripple) => <span key={ripple.id} className="bripple" style={{ left: ripple.x, top: ripple.y }} />)}
        </div>
      </section>
      <aside className="bside">
        <div className="bacts-card">
          <h3>Activity</h3>
          {live.actions.length ? <ol className="bacts">{live.actions.map((action, index) => <li key={`${action.at}-${index}`}>
            <span className="bact-t"><b>{ACTION_WORDS[action.action] ?? action.action}</b><span className="mute">{ago(action.at)}</span></span>
            {action.url && <span className="bact-url ellip" title={action.url}>{addressOf(action.url).host}{addressOf(action.url).rest}</span>}
          </li>)}</ol> : <div className="bempty">
            <span /><span /><span />
            <p>Nothing yet. {name}'s clicks and page loads appear here.</p>
          </div>}
        </div>
        <p className="bhelp" title={`Only people who can edit ${name} can open this page. The picture stops when you close the tab.`}><b>Take over</b> to log in or get past a check. {name} can't act until you hand back, or after 2 minutes without input.</p>
        {live.error && <ErrorNote message={live.error} />}
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
  const [frame, setFrame] = useState<{ data: string }>()
  const [page, setPage] = useState({ url: '', title: '' })
  const [heldBy, setHeldBy] = useState<string | null>(null)
  const [actions, setActions] = useState<{ action: string; url: string; at: number }[]>([])
  const [state, setState] = useState<'connecting' | 'live' | 'closed'>('connecting')
  const [error, setError] = useState<string>()
  const [, setTicks] = useState(0)
  useEffect(() => {
    const tick = setInterval(() => setTicks((n) => n + 1), 10_000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    const source = new EventSource(`${browserPath(agentId)}/stream`)
    const on = (event: string, handle: (data: unknown) => void) => source.addEventListener(event, (message) => handle(JSON.parse(message.data)))
    on('frame', (data) => { setFrame(data as typeof frame); setState('live') })
    on('page', (data) => setPage(data as typeof page))
    on('hold', (data) => setHeldBy((data as { heldBy: string | null }).heldBy))
    on('action', (data) => setActions((known) => [{ ...(data as { action: string; url: string }), at: Date.now() }, ...known].slice(0, ACTIONS_SHOWN)))
    on('closed', () => { setState('closed'); setFrame(undefined) })
    source.onopen = () => setError(undefined)
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return
      setState('closed')
      request({ schema: Browser, path: browserPath(agentId) }).then(() => setError('The live view stopped. Reload the page to try again.'), (failure: Error) => setError(failure.message))
    }
    return () => source.close()
  }, [agentId])
  return { frame, page, heldBy, actions, state, error }
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
