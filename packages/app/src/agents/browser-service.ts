import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Browser, BrowserInputAccepted, BrowserInputEvent } from '@openhut/common/agents/browser.ts'
import { agentd, liveBrowser, type LiveBrowser } from '../platform/agentd.ts'
import { record } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import type { Caller } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

const MAX_VIEWERS = 3
const FRAME_GAP_MS = 33
const HOLD_IDLE_MS = 120_000
const KEEPALIVE_MS = 15_000
const RETRY_MS = 4_000
const PING_MS = 10_000
const MAX_FRAME = 4 << 20
const BOUNDARY = 'openhut-frame'
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const MOUSE_EVENTS = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved', wheel: 'mouseWheel' } as const
const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
}
const CTRL_OR_META = 2 | 4
const sessions = new Map<string, Session>()

export const browserService = {
  async get({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Browser> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    if (!row.web_browser) return browserOf({ agentId, open: false, url: '', title: '', still: null })
    const still = await agentd.browserStill({ id: agentId })
    return browserOf({ agentId, open: still.open, url: still.url, title: still.title, still: still.data ? `data:image/jpeg;base64,${still.data}` : null })
  },

  async stream({ actor, agentId, req, reply }: { actor: Caller; agentId: string; req: FastifyRequest; reply: FastifyReply }): Promise<void> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    if (!row.web_browser) throw new HttpError(409, `${row.name}'s browser is off. Switch Browser on in ${row.name}'s settings first.`)
    const session = sessionOf(agentId)
    if (session.viewers.size >= MAX_VIEWERS) throw new HttpError(429, `${MAX_VIEWERS} people are already watching ${row.name}'s browser. Try again when one of them closes it.`)
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' })
    res.write(`retry: ${RETRY_MS}\n\n`)
    const viewer: Viewer = { personId: actor.id, write: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`), end: () => res.end() }
    session.viewers.add(viewer)
    viewer.write('page', session.page)
    viewer.write('hold', { heldBy: session.holder?.email ?? null })
    if (session.frame) viewer.write('frame', {})
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS)
    req.raw.on('close', () => {
      clearInterval(keepalive)
      leave({ session, viewer })
    })
  },

  async frames({ actor, agentId, req, reply }: { actor: Caller; agentId: string; req: FastifyRequest; reply: FastifyReply }): Promise<void> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    if (!row.web_browser) throw new HttpError(409, `${row.name}'s browser is off. Switch Browser on in ${row.name}'s settings first.`)
    const session = sessionOf(agentId)
    if (session.screens.size >= MAX_VIEWERS) throw new HttpError(429, `${MAX_VIEWERS} people are already watching ${row.name}'s browser. Try again when one of them closes it.`)
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, 'cache-control': 'no-cache, no-store, no-transform', 'x-accel-buffering': 'no' })
    const screen: Screen = (jpeg) => {
      if (res.writableNeedDrain) return
      res.write(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`)
      res.write(jpeg)
      res.write('\r\n')
    }
    session.screens.set(screen, () => res.end())
    if (session.frame) screen(session.frame)
    req.raw.on('close', () => {
      session.screens.delete(screen)
      closeIfUnwatched(session)
    })
  },

  async hold({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Browser> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    const session = sessions.get(agentId)
    if (!session) throw new HttpError(409, `Open ${row.name}'s live browser first, then take over.`)
    if (session.holder && session.holder.personId !== actor.id) throw new HttpError(409, `${session.holder.email} is using ${row.name}'s browser. Ask them to hand it back first.`)
    await agentd.holdBrowser({ id: agentId, held: true })
    session.holder = { personId: actor.id, email: actor.email }
    keepHolding(session)
    broadcast(session, 'hold', { heldBy: actor.email })
    record({ action: 'browser.held', actor, target: { type: 'agent', id: agentId, name: row.name } })
    return stateOf(session)
  },

  async release({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Browser> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    const session = sessions.get(agentId)
    if (!session?.holder) return session ? stateOf(session) : browserOf({ agentId, open: false, url: '', title: '', still: null })
    await letGo(session)
    record({ action: 'browser.released', actor, target: { type: 'agent', id: agentId, name: row.name } })
    return stateOf(session)
  },

  async input({ actor, agentId, events }: { actor: Caller; agentId: string; events: BrowserInputEvent[] }): Promise<BrowserInputAccepted> {
    const row = await agentService.requireEditable({ actor, id: agentId })
    const session = sessions.get(agentId)
    if (!session || session.holder?.personId !== actor.id) throw new HttpError(409, `Press Take over on ${row.name}'s live browser before clicking or typing in it.`)
    for (const event of events) session.live.send(inputLine(event))
    keepHolding(session)
    return { object: 'browser_input', agentId, accepted: events.length }
  },
}

export function inputLine(event: BrowserInputEvent): string {
  if (event.type === 'mouse') {
    const pressing = event.action === 'down' || event.action === 'up'
    return JSON.stringify({
      type: 'input_mouse', eventType: MOUSE_EVENTS[event.action], x: event.x, y: event.y, button: pressing ? event.button ?? 'left' : 'none',
      clickCount: pressing ? event.clickCount ?? 1 : 0, deltaX: event.deltaX ?? 0, deltaY: event.deltaY ?? 0, modifiers: event.modifiers ?? 0,
    })
  }
  const printable = [...event.key].length === 1 && !((event.modifiers ?? 0) & CTRL_OR_META)
  const text = event.action === 'down' ? (event.key === 'Enter' ? '\r' : printable ? event.key : undefined) : undefined
  const code = KEY_CODES[event.key] ?? ([...event.key].length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0)
  return JSON.stringify({
    type: 'input_keyboard', eventType: event.action === 'down' ? 'keyDown' : 'keyUp', key: event.key, code: event.code ?? '', text,
    windowsVirtualKeyCode: code, modifiers: event.modifiers ?? 0,
  })
}

function sessionOf(agentId: string): Session {
  const known = sessions.get(agentId)
  if (known) return known
  const session: Session = { agentId, viewers: new Set(), screens: new Map(), page: { url: '', title: '' }, sentAt: 0, live: { send: () => undefined, close: () => undefined } }
  session.live = liveBrowser({ id: agentId, onLine: (line) => onLine({ session, line }), onEnd: () => void ended(session) })
  session.pinger = setInterval(() => session.live.send(JSON.stringify({ type: 'ping' })), PING_MS)
  sessions.set(agentId, session)
  return session
}

function onLine({ session, line }: { session: Session; line: string }): void {
  const message = objectOf(line)
  switch (message?.type) {
    case 'frame': return showFrame({ session, message })
    case 'tabs': return showPage({ session, page: activeTab(message.tabs) })
    case 'url': return showPage({ session, page: { ...session.page, url: textOf(message.url, 2048) } })
    case 'command': return broadcast(session, 'action', { action: textOf(message.action, 40), url: textOf(objectOf(message.params)?.url, 2048) })
  }
}

function showFrame({ session, message }: { session: Session; message: Record<string, unknown> }): void {
  if (typeof message.data !== 'string' || message.data.length > MAX_FRAME || !BASE64.test(message.data)) return
  session.frame = Buffer.from(message.data, 'base64')
  if (session.frameTimer) return
  const wait = Math.max(0, session.sentAt + FRAME_GAP_MS - Date.now())
  session.frameTimer = setTimeout(() => {
    session.frameTimer = undefined
    session.sentAt = Date.now()
    for (const screen of session.screens.keys()) if (session.frame) screen(session.frame)
    broadcast(session, 'frame', {})
  }, wait)
}

function showPage({ session, page }: { session: Session; page: { url: string; title: string } }): void {
  session.page = page
  broadcast(session, 'page', page)
}

function broadcast(session: Session, event: string, data: unknown): void {
  for (const viewer of session.viewers) viewer.write(event, data)
}

function leave({ session, viewer }: { session: Session; viewer: Viewer }): void {
  session.viewers.delete(viewer)
  closeIfUnwatched(session)
}

function closeIfUnwatched(session: Session): void {
  if (session.viewers.size || session.screens.size || sessions.get(session.agentId) !== session) return
  session.live.close()
}

async function ended(session: Session): Promise<void> {
  if (sessions.get(session.agentId) === session) sessions.delete(session.agentId)
  clearTimeout(session.frameTimer)
  clearInterval(session.pinger)
  broadcast(session, 'closed', {})
  for (const viewer of session.viewers) viewer.end()
  for (const end of session.screens.values()) end()
  if (session.holder) await letGo(session).catch(() => undefined)
}

function keepHolding(session: Session): void {
  clearTimeout(session.holdTimer)
  session.holdTimer = setTimeout(() => void letGo(session).catch(() => undefined), HOLD_IDLE_MS)
}

async function letGo(session: Session): Promise<void> {
  clearTimeout(session.holdTimer)
  session.holder = undefined
  await agentd.holdBrowser({ id: session.agentId, held: false })
  broadcast(session, 'hold', { heldBy: null })
}

function stateOf(session: Session): Browser {
  return browserOf({ agentId: session.agentId, open: true, url: session.page.url, title: session.page.title, still: null })
}

function browserOf({ agentId, open, url, title, still }: Omit<Browser, 'id' | 'object' | 'agentId' | 'heldBy'> & { agentId: string }): Browser {
  return { id: agentId, object: 'browser', agentId, open, url, title, still, heldBy: sessions.get(agentId)?.holder?.email ?? null }
}

function activeTab(tabs: unknown): { url: string; title: string } {
  const list = Array.isArray(tabs) ? tabs.map(objectOf) : []
  const tab = list.find((each) => each?.active === true) ?? list[0]
  return { url: textOf(tab?.url, 2048), title: textOf(tab?.title, 300) }
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  const parsed: unknown = typeof value === 'string' ? jsonOf(value) : value
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : undefined
}

function jsonOf(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function textOf(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

type Viewer = { personId: string; write: (event: string, data: unknown) => void; end: () => void }
type Screen = (jpeg: Buffer) => void
type Session = {
  agentId: string
  live: LiveBrowser
  viewers: Set<Viewer>
  page: { url: string; title: string }
  screens: Map<Screen, () => void>
  frame?: Buffer
  frameTimer?: NodeJS.Timeout
  sentAt: number
  holder?: { personId: string; email: string }
  holdTimer?: NodeJS.Timeout
  pinger?: NodeJS.Timeout
}
