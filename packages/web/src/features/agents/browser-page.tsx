import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Browser, BrowserInputAccepted, type BrowserInputEvent } from '@openhut/common/agents/browser.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { ErrorNote } from '@/components/error-note'
import { request } from '@/lib/api-client'
import { toastError } from '@/lib/toast'
import { browserPath, useAgent, useHoldBrowser } from '@/features/agents/api'

const FLUSH_MS = 40
const MOVE_MS = 80
const BATCH = 64
const ACTIONS_SHOWN = 8

export function BrowserPage({ me, agentId }: { me: Me; agentId: string }) {
  const agent = useAgent(agentId)
  const live = useLive(agentId)
  const hold = useHoldBrowser(agentId)
  const mine = live.heldBy === me.user.email
  const send = useInput(agentId, mine)
  const screen = useRef<HTMLDivElement>(null)
  const movedAt = useRef(0)
  useEffect(() => { document.title = `${agent.data?.name ?? 'Agent'}'s browser · OpenHut` }, [agent.data?.name])
  useEffect(() => { if (mine) screen.current?.focus() }, [mine])
  useEffect(() => {
    if (!mine) return
    const handBack = () => void fetch(`${browserPath(agentId)}/hold`, { method: 'DELETE', keepalive: true })
    window.addEventListener('pagehide', handBack)
    return () => window.removeEventListener('pagehide', handBack)
  }, [agentId, mine])
  if (agent.error) return <div className="bpage"><ErrorNote message={agent.error.message} /></div>
  const name = agent.data?.name ?? 'The agent'
  const point = (event: MouseEvent<HTMLElement> | WheelEvent<HTMLElement>) => {
    const picture = screen.current?.querySelector('img')
    const box = (picture ?? event.currentTarget).getBoundingClientRect()
    const scale = picture?.naturalWidth ? picture.naturalWidth / box.width : 1
    return { x: Math.max(0, Math.round((event.clientX - box.left) * scale)), y: Math.max(0, Math.round((event.clientY - box.top) * scale)) }
  }
  const mouse = (action: 'down' | 'up' | 'move') => (event: MouseEvent<HTMLElement>) => {
    if (!mine) return
    event.preventDefault()
    if (action === 'down') screen.current?.focus({ preventScroll: true })
    if (action === 'move' && Date.now() - movedAt.current < MOVE_MS) return
    if (action === 'move') movedAt.current = Date.now()
    send({ type: 'mouse', action, ...point(event), button: (['left', 'middle', 'right'] as const)[event.button] ?? 'left', modifiers: modifiersOf(event) })
  }
  const key = (action: 'down' | 'up') => (event: KeyboardEvent<HTMLElement>) => {
    if (!mine) return
    event.preventDefault()
    send({ type: 'key', action, key: event.key, code: event.code, modifiers: modifiersOf(event) })
  }
  const toggle = () => hold.mutate(!mine, { onError: toastError })
  const heldByOther = live.heldBy && !mine
  return <div className="bpage">
    <header className="bbar">
      <span className="bwho">{agent.data && <Avatar id={agent.data.id} about={agent.data.instructions} size={22} />}<b className="ellip">{name}'s browser</b></span>
      <div className="burl"><span className="mono ellip" title={live.page.url}>{live.page.url || (live.state === 'closed' ? 'No page open' : 'Connecting…')}</span>{live.state === 'live' && <span className="blive"><i />Live</span>}</div>
      <span className="mute bstate">{mine ? 'You are in control. Clicks and keys go to the page.' : heldByOther ? `${live.heldBy} is in control.` : `${name} is driving.`}</span>
      <button type="button" className={mine ? 'btn' : 'btn sec'} disabled={!!heldByOther || hold.isPending || live.state !== 'live'} onClick={toggle}>{mine ? `Hand back to ${name}` : 'Take over'}</button>
    </header>
    <main className="bbody">
      <div className={mine ? 'bscreen held' : 'bscreen'} ref={screen} tabIndex={mine ? 0 : -1} role="application" aria-label={`${name}'s browser`}
        onMouseDown={mouse('down')} onMouseUp={mouse('up')} onMouseMove={mouse('move')} onContextMenu={(event) => mine && event.preventDefault()}
        onWheel={(event) => mine && send({ type: 'mouse', action: 'wheel', ...point(event), deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) })}
        onKeyDown={key('down')} onKeyUp={key('up')}
        onPaste={(event) => { if (!mine) return; event.preventDefault(); for (const char of event.clipboardData.getData('text').slice(0, 500)) { send({ type: 'key', action: 'down', key: char }); send({ type: 'key', action: 'up', key: char }) } }}>
        {live.frame ? <img src={`data:image/jpeg;base64,${live.frame.data}`} alt={`The page ${name} has open: ${live.page.title}`} draggable={false} /> : <p className="bwait">{live.state === 'closed' ? `${name} hasn't opened a page. This view starts when it does.` : 'Connecting to the browser…'}</p>}
        {mine && <span className="bheld">You are in control. {name} waits until you hand back.</span>}
      </div>
      <aside className="bside">
        <h3>What {name} did</h3>
        {live.actions.length ? <ol className="bacts">{live.actions.map((action, index) => <li key={index}><span className="mono">{action.action}</span><span className="mute ellip" title={action.url}>{action.url}</span></li>)}</ol> : <p className="note">Nothing yet in this view.</p>}
        <p className="note">Only people who can edit {name} can open this page. The picture stops when you close the tab. Take over to log in or get past a check; {name} can't act until you hand back, or after 2 minutes without input.</p>
        {live.error && <ErrorNote message={live.error} />}
      </aside>
    </main>
  </div>
}

function useLive(agentId: string) {
  const [frame, setFrame] = useState<{ data: string }>()
  const [page, setPage] = useState({ url: '', title: '' })
  const [heldBy, setHeldBy] = useState<string | null>(null)
  const [actions, setActions] = useState<{ action: string; url: string }[]>([])
  const [state, setState] = useState<'connecting' | 'live' | 'closed'>('connecting')
  const [error, setError] = useState<string>()
  useEffect(() => {
    const source = new EventSource(`${browserPath(agentId)}/stream`)
    const on = (event: string, handle: (data: unknown) => void) => source.addEventListener(event, (message) => handle(JSON.parse(message.data)))
    on('frame', (data) => { setFrame(data as typeof frame); setState('live') })
    on('page', (data) => setPage(data as typeof page))
    on('hold', (data) => setHeldBy((data as { heldBy: string | null }).heldBy))
    on('action', (data) => setActions((known) => [data as { action: string; url: string }, ...known].slice(0, ACTIONS_SHOWN)))
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

function modifiersOf(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}
