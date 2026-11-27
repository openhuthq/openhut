import { createContext, useEffect, useState, type MouseEvent, type ReactElement } from 'react'
import { ArchiveIcon, ArrowDown01Icon, ArrowRight01Icon, BubbleChatIcon, Clock01Icon, Delete02Icon, Logout01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, SidebarLeftIcon, StopIcon, WebhookIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@/lib/openhut'
import { Subagent } from '@openhut/common/agents/subagent.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, LongPressMenu } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-button'
import { Glyph } from '@/components/glyph'
import { Hut } from '@/components/hut'
import { GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { agentPath, threadRoute } from '@/app/routes'
import { firstThreads, sourceOf, startedIn, type SourcedThread } from '@/features/threads/places'
import { useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { toneOf, troubleOf, wordOf } from '@/features/agents/status'
import { useSignOut } from '@/features/auth/api'
import { useOwner } from '@/features/people/api'
import { useConnections } from '@/features/connections/api'
import { chipMarks } from '@/features/connections/catalog'
import { UpdateEverything } from '@/features/settings/update-pill'
import { ago, personName } from '@/lib/format'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useAgentsLive, usePresence, type LiveAgentBoard } from '@/lib/thread-live'
import { useArchiveThread } from '@/features/threads/api'
import { summaryOf, type Progress } from '@/features/agents/progress'

const ROUND = 'float phone:size-10 phone:rounded-full phone:bg-card phone:text-ink'

const LIVE = { on: 'bg-pass', wait: 'animate-[blinkdot_1s_infinite] bg-amber', bad: 'bg-fail', off: 'bg-mute-2' }

export type Contact = { agent: OpenHutAgent; threads: SourcedThread[] }

export const SidebarContext = createContext<{ collapsed: boolean } | null>(null)

export function ShowSidebar({ onExpand, onNew }: { onExpand: () => void; onNew: () => void }) {
  return <span className={cn('absolute top-[env(safe-area-inset-top)] left-0 z-10 flex h-[52px] items-center gap-0.5 pl-3 phone:hidden animate-[fadein_120ms_80ms_ease-out_backwards]')}>
    <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Show sidebar" title="Show sidebar ⌘\" onClick={onExpand}><I icon={SidebarLeftIcon} size={16} /></Button>
    <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={16} /></Button>
  </span>
}

export function Sidebar({ contacts, activeId, threadId, collapsed, onCollapse, onNew }: {
  contacts: Contact[]; activeId: string | undefined; threadId: string | undefined; collapsed: boolean; onCollapse: () => void; onNew: () => void
}) {
  const phone = useMedia(PHONE)
  return <aside inert={collapsed} className={cn('pushable still shrink-0 overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring)', collapsed ? 'w-0' : 'w-[280px] border-r-[0.5px]', contacts.length ? 'phone:w-full phone:border-r-0' : 'phone:hidden', GLASS)}>
    <div className={cn('flex h-full w-[280px] flex-col phone:w-full transition-[opacity,translate] duration-[160ms] ease-out', collapsed && '-translate-x-2 opacity-0')}>
    <div className={cn('flex h-[44px] shrink-0 items-center gap-1.5 pr-3 pl-3 phone:h-16 phone:px-4')}>
      <a href="/" aria-label="OpenHut" title="OpenHut" className="flex items-center gap-1.5 text-[14px] font-semibold text-ink no-underline phone:hidden"><Hut className="size-6" />OpenHut</a>
      <a href="/settings/people" aria-label="Settings" className={cn(ICON_BUTTON, ROUND, 'hidden phone:grid')}><I icon={Settings02Icon} size={20} /></a>
      <span className="ml-auto flex gap-1.5">
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, 'phone:hidden')} aria-label="Hide sidebar" title="Hide sidebar ⌘\" onClick={onCollapse}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, ROUND)} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={phone ? 20 : 16} /></Button>
      </span>
    </div>
    <h1 className="m-0 hidden px-5 pt-1 pb-3 text-[32px]/[1.1] font-bold tracking-[-.02em] phone:block">Agents</h1>
    <nav className="flex min-h-0 flex-col gap-1 overflow-auto px-3 pt-1 phone:gap-0 phone:px-2">
      {contacts.length > 0 && <div className="flex flex-col gap-1 phone:gap-0">
      {contacts.map(({ agent, threads }) => <AgentRow key={agent.id} agent={agent} threads={threads} active={agent.id === activeId} threadId={agent.id === activeId ? threadId : undefined} phone={phone} />)}
      </div>}
      {!contacts.length && <Button type="button" variant="bare" onClick={onNew} className={cn('grid h-auto w-full grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left font-normal text-inherit', HOVER)}>
        <span className="grid size-10 place-items-center rounded-[24%] border-[1.5px] border-dashed border-mute-2 text-mute"><I icon={PlusSignIcon} size={16} /></span>
        <span className="grid min-w-0 gap-0.5"><span className="truncate text-[14px] font-semibold">New agent</span><span className="truncate text-[13px] text-body">Make your first agent</span></span>
      </Button>}
    </nav>
    <footer className="mt-auto flex flex-col items-start gap-2 px-3 pt-2 pb-3">
      <UpdateEverything />
      <div className="flex w-full items-center gap-2">
        <You />
        <a href="/connections" className={cn(SURFACE, 'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg pr-3 pl-3.5 text-[13.5px] font-medium')}>
          <ConnectedMarks />
        </a>
        <Gear />
      </div>
    </footer>
    </div>
  </aside>
}

const FIRST = 5

const FADE_MS = 1500

function useSubagents(agentId: string): (Subagent & { gone: boolean })[] {
  const data = useAgentsLive().get(agentId)?.subagents
  const [faded, setFaded] = useState<Set<string>>(new Set())
  const done = (data ?? []).filter((item) => item.status === 'done' && !faded.has(item.id)).map((item) => item.id).join(' ')
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => setFaded((now) => new Set([...now, ...done.split(' ')])), FADE_MS)
    return () => clearTimeout(timer)
  }, [done])
  return (data ?? []).map((item) => ({ ...item, gone: faded.has(item.id) }))
}

function AgentRow({ agent, threads, active, threadId, phone }: { agent: OpenHutAgent; threads: SourcedThread[]; active: boolean; threadId: string | undefined; phone: boolean }) {
  const children = useSubagents(agent.id)
  const activity = useAgentsLive().get(agent.id)?.activity ?? 'idle'
  const [expanded, setExpanded] = useState(active)
  useEffect(() => { if (active) setExpanded(true) }, [active])
  const working = children.filter((child) => child.status === 'working').length
  useTick(working > 0)
  const listed = threads.filter((thread) => thread.id !== agent.id)
  const sessions = firstThreads(listed)
  const waiting = threads.filter((each) => each.waiting).length
  const subagents = children.filter((child) => !child.gone).length
  const thread = threads[0]
  const shown = subagents + sessions.length
  const open = (phone || expanded) && shown > 0
  const idle = agent.online ? troubleOf(agent) ?? (agent.summary || 'Say hello') : 'Offline'
  const line = lineOf({ working, waiting, activity, idle })
  const summary = summaryOf({ working, waiting, activity })
  const [more, setMore] = useState(false)
  const rows = children.map((child) => <Session key={child.id} gone={child.gone} title={child.title} status={child.status} time={ago(child.startedAt)} />)
  const cut = children.findIndex((_, index) => children.slice(0, index + 1).filter((child) => !child.gone).length > FIRST)
  const toggle = () => setExpanded(!open)
  return <div className="flex flex-col">
    <div className="group/agent relative">
    <RowMenu agent={agent}><a href={agentPath({ agentId: agent.id })} aria-current={active ? 'page' : undefined}
      className={cn('row grid h-10 w-full shrink-0 data-popup-open:bg-picked grid-cols-[28px_1fr_auto] items-center gap-2.5 rounded-lg px-2 text-left text-inherit no-underline phone:h-auto phone:grid-cols-[52px_1fr_auto] phone:gap-3.5 phone:rounded-2xl phone:px-3 phone:py-3', HOVER, !phone && active && !(open && sessions.some((each) => each.id === threadId)) && PICKED)}
      title={agent.online ? undefined : 'Offline'}>
      <span className={cn('relative', !agent.online && 'opacity-45')}><Face agent={agent} size={phone ? 52 : 28} /><Live agent={agent} className="-right-0.5 -bottom-0.5 size-2.5 border-[1.5px] phone:size-3.5 phone:border-2" /></span>
      <span className="grid min-w-0 gap-0.5">
        <span className={cn('truncate text-[13.5px] font-semibold phone:text-[17px]', !agent.online && 'text-mute')}>{agent.name}</span>
        <span className={cn('hidden truncate text-[13px] phone:block', agent.online ? 'text-body' : 'text-mute', agent.online && !working && troubleOf(agent) && 'text-fail')}>{line}</span>
      </span>
      {thread && <span className="hidden self-start pt-1 text-[12px] text-mute tabular-nums phone:block">{ago(thread.updatedAt)}</span>}
      <span className={cn('flex items-center text-[11.5px] text-mute tabular-nums phone:hidden', shown > 0 && 'transition-opacity group-hover/agent:opacity-0 group-focus-within/agent:opacity-0')}>{open ? listed.length || '' : summary && <Mark status={summary} />}</span>
    </a></RowMenu>
    {shown > 0 && !phone && <Button type="button" variant="bare" aria-label={open ? `Collapse ${agent.name}` : `Expand ${agent.name}`} aria-expanded={open} onClick={toggle}
      className={cn('absolute top-2 right-1 grid size-6 place-items-center rounded-md text-mute opacity-0 transition-opacity group-hover/agent:opacity-100 focus-visible:opacity-100', HOVER)}>
      <I icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} />
    </Button>}
    </div>
    {open && <div className="relative flex flex-col gap-px pt-0.5 pb-2.5 pl-[38px] [--mark:14px] [--mark-gap:8px] before:absolute before:top-0 before:bottom-2.5 before:left-[22px] before:w-px before:bg-hair phone:gap-0.5 phone:pt-1.5 phone:pb-2 phone:pl-[48px] phone:[--mark:28px] phone:[--mark-gap:10px] phone:before:hidden">
      {more ? rows : rows.slice(0, cut === -1 ? rows.length : cut)}
      {subagents > FIRST && <Button type="button" variant="bare" onClick={() => setMore(!more)} className={cn(MORE, HOVER)}>
        {more ? 'Show less' : `Show ${subagents - FIRST} more`}
      </Button>}
      {sessions.map((each) => <ThreadRow key={each.id} agentId={agent.id} thread={each} active={threadId === each.id} />)}
      {listed.length > sessions.length && <a href={agentPath({ agentId: agent.id, dialog: 'threads' })} className={cn(MORE, 'no-underline', HOVER)}>Show all ({listed.length})</a>}
    </div>}
  </div>
}

const MORE = 'flex h-[30px] w-full items-center justify-start rounded-lg pr-2 pl-[30px] text-[12.5px] phone:pl-[46px] font-normal text-mute'

function lineOf({ working, waiting, activity, idle }: { working: number; waiting: number; activity: LiveAgentBoard['activity']; idle: string }) {
  if (working) return `Working on ${working} ${working === 1 ? 'task' : 'tasks'}`
  if (activity === 'working') return 'Working…'
  if (waiting) return `${waiting} waiting`
  if (activity === 'waiting') return 'Waiting on you'
  return idle
}

const SOURCE_ICON = { app: BubbleChatIcon, webhook: WebhookIcon, routine: Clock01Icon }

const ROW = 'grid h-[30px] shrink-0 grid-cols-[var(--mark,28px)_1fr_auto] items-center gap-(--mark-gap,10px) rounded-lg px-2 text-inherit no-underline'

export function ThreadRow({ agentId, thread, active }: { agentId: string; thread: SourcedThread; active: boolean }) {
  const source = sourceOf(thread)
  const busy = usePresence(thread.id).agent.state !== 'idle'
  const archive = useArchiveThread(thread)
  const main = thread.id === thread.agentId
  const where = startedIn(thread)
  const status = thread.waiting ? 'review' : busy ? 'working' : 'idle'
  const onArchive = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    archive.mutate(undefined, { onSuccess: () => active && navigate(agentPath({ agentId })), onError: toastError })
  }
  return <div className="group/thread relative">
  <a href={threadRoute({ agentId, threadId: thread.id })} aria-current={active ? 'page' : undefined} className={cn(ROW, HOVER, active && PICKED)}>
    <span className="grid place-items-center text-mute-2"><Mark status={status} /></span>
    <span className="truncate text-[13px] font-medium text-ink">{thread.title}</span>
    <span className={cn('flex items-center gap-[5px] text-[11.5px] text-mute tabular-nums', !main && 'group-hover/thread:invisible group-focus-within/thread:invisible')}>
      <span role="img" aria-label={where} title={where} className="grid place-items-center">{source.platform === 'discord' ? <Glyph name="discord" size={12} /> : <I icon={SOURCE_ICON[source.platform]} size={12} />}</span>
      {ago(thread.updatedAt)}
    </span>
  </a>
  {!main && <Button type="button" variant="bare" aria-label={`Archive ${thread.title}`} title="Archive" disabled={archive.isPending} onClick={onArchive}
    className={cn('absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-mute opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100', HOVER)}>
    <I icon={ArchiveIcon} size={14} />
  </Button>}
  </div>
}

function Session({ gone, title, status, time }: { gone: boolean; title: string; status: Progress; time: string }) {
  return <div title="Sub-agent" className={cn(ROW, 'overflow-hidden transition-[height,opacity] duration-500 ease-out', HOVER, gone && 'h-0 opacity-0')}>
    <span className="grid place-items-center text-mute-2"><Mark status={status} /></span>
    <span className={cn('min-w-0 truncate text-[13px] font-medium', status === 'done' ? 'text-body' : 'text-ink')}>{title}</span>
    <span className="text-[11.5px] text-mute tabular-nums">{time}</span>
  </div>
}

const MARK: Record<Progress, ReactElement> = {
  idle: <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  queued: <circle cx="7" cy="7" r="6" fill="none" stroke="#8a8a8a" strokeWidth="1.5" strokeDasharray="2.2 1.9" />,
  working: <><circle cx="7" cy="7" r="6" fill="none" stroke="#CDA23A" strokeWidth="1.5" /><path d="M7 4a3 3 0 0 1 0 6z" fill="#CDA23A" /></>,
  review: <><circle cx="7" cy="7" r="6" fill="none" stroke="#D9824A" strokeWidth="1.5" /><circle cx="7" cy="7" r="2.2" fill="#D9824A" /></>,
  done: <><circle cx="7" cy="7" r="7" fill="#8A90CF" /><path d="M4.2 7.2l1.9 1.9 3.7-3.9" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>,
  failed: <><circle cx="7" cy="7" r="6" fill="none" stroke="#a3a3a3" strokeWidth="1.5" /><path d="M5.2 5.2l3.6 3.6M8.8 5.2l-3.6 3.6" stroke="#a3a3a3" strokeWidth="1.6" strokeLinecap="round" /></>,
}

function Mark({ status }: { status: Progress }) {
  return <svg role="img" aria-label={MARK_LABEL[status]} width="14" height="14" viewBox="0 0 14 14" className={cn('shrink-0', (status === 'done' || status === 'failed') && 'animate-[pop_.4s_ease-out] motion-reduce:animate-none')}>{MARK[status]}</svg>
}

const MARK_LABEL: Record<Progress, string> = { idle: 'Idle', queued: 'Queued', working: 'Working', review: 'Needs you', done: 'Done', failed: 'Failed' }

function RowMenu({ agent, children }: { agent: OpenHutAgent; children: ReactElement }) {
  const update = useUpdateAgent(agent.id)
  const remove = useDeleteAgent(agent.id)
  const [deleting, setDeleting] = useState(false)
  const running = agent.wanted === 'running'
  return <>
    <LongPressMenu menu={<>
      <DropdownMenuItem onClick={() => navigate(agentPath({ agentId: agent.id }))}><I icon={Message01Icon} size={16} />Open chat</DropdownMenuItem>
      {agent.canEdit && <DropdownMenuItem disabled={!agent.online} onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'customize' }))}><I icon={PencilEdit02Icon} size={16} />Customize</DropdownMenuItem>}
      {agent.canEdit && <DropdownMenuItem disabled={!agent.online} onClick={() => update.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} />{running ? 'Stop' : 'Start'}</DropdownMenuItem>}
      {agent.canEdit && agent.canManage && <DropdownMenuItem variant="destructive" disabled={!agent.online} onClick={() => setDeleting(true)}><I icon={Delete02Icon} size={16} />Delete…</DropdownMenuItem>}
    </>}>{children}</LongPressMenu>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} question={`Delete ${agent.name}?`} detail="Its chats, memory and skills go with it." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })} />
  </>
}

function Gear() {
  return <a href="/settings/people" aria-label="Settings" title="Settings" className={cn(SURFACE, 'grid phone:hidden size-10 shrink-0 place-items-center rounded-lg')}><I icon={Settings02Icon} size={17} /></a>
}

function Live({ agent, className }: { agent: OpenHutAgent; className: string }) {
  const tone = toneOf(agent)
  return <i title={wordOf(agent)} className={cn('absolute size-3 rounded-full border-2 border-sidebar', LIVE[tone], className)} />
}

function ConnectedMarks() {
  const { shown, more } = chipMarks(useConnections().data?.map((connection) => connection.kind) ?? [])
  if (!shown.length) return <><I icon={PlusSignIcon} size={15} className="text-mute" /><span className="truncate">Connect apps</span></>
  return <>
    <span className="truncate" title="Your connected apps">Apps</span>
    <span className="ml-auto flex shrink-0 items-center gap-1">{shown.map((kind) => <Glyph key={kind} name={kind} size={14} />)}{more > 0 && <span className="text-[11.5px] font-normal text-mute">+{more}</span>}</span>
  </>
}

function You() {
  const email = useOwner()
  const name = personName(email)
  const signOut = useSignOut()
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="bare" aria-label={`You: ${name}`} title={name} className={cn(SURFACE, 'relative grid size-10 shrink-0 place-items-center rounded-lg')} />}>
      <PersonFace name={name} email={email} size={24} />
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="flex w-[260px] flex-col gap-0.5 rounded-lg p-1.5 shadow-menu">
      <div className="flex items-center gap-2.5 px-2 py-1.5"><PersonFace name={name} email={email} size={28} /><span className="grid min-w-0 leading-tight"><span className="truncate text-[13px] font-medium">{name}</span><span className="truncate text-[11.5px] text-mute">{email}</span></span></div>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="h-8 gap-2.5 px-2 text-[13px]" disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}><I icon={Logout01Icon} size={15} className="text-mute" />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

function useTick(ticking: boolean): void {
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!ticking) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [ticking])
}
