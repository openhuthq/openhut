import { createContext, useEffect, useState, type MouseEvent, type ReactElement } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { ArchiveIcon, CancelCircleIcon, CheckmarkCircle02Icon, CircleIcon, DashedLineCircleIcon, PauseCircleIcon, ArrowDown01Icon, ArrowRight01Icon, BubbleChatIcon, Clock01Icon, Delete02Icon, GitBranchIcon, Logout01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, SidebarLeftIcon, StopIcon, WebhookIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@/lib/openhut'
import { useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Subagent } from '@openhut/common/agents/subagent.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, LongPressMenu } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-button'
import { Glyph } from '@/components/glyph'
import { request } from '@/lib/api-client'
import { Hut } from '@/components/hut'
import { GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { agentPath, threadRoute } from '@/app/routes'
import { firstThreads, sourceOf, type SourcedThread } from '@/features/threads/places'
import { useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { Face, lookOf } from '@/features/agents/face'
import { SWATCHES } from '@/lib/face'
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
import { useLiveLine } from '@/features/threads/live'
import { useArchiveThread } from '@/features/threads/api'

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

const SUBAGENT_LIST = List(Subagent)
const FADE_MS = 1500

function useSubagents(agentId: string | undefined): (Subagent & { gone: boolean })[] {
  const { data } = useQuery({
    queryKey: ['subagents', agentId],
    queryFn: async () => (await request({ schema: SUBAGENT_LIST, of: agentId, path: `/api/agents/${agentId}/subagents` })).data,
    enabled: agentId !== undefined,
    refetchInterval: (query) => query.state.data?.some((item) => item.status === 'working') ? 2_000 : 5_000,
  })
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
  const children = useSubagents(agent.wanted === 'running' && agent.online ? agent.id : undefined)
  const [choice, setChoice] = useState<{ active: boolean; open: boolean }>()
  const working = children.filter((child) => child.status === 'working').length
  useTick(working > 0)
  const listed = threads.filter((thread) => thread.id !== agent.id)
  const sessions = firstThreads(listed)
  const waiting = threads.filter((each) => each.waiting).length
  const subagents = children.filter((child) => !child.gone).length
  const thread = threads[0]
  const shown = subagents + sessions.length
  const open = (phone || (choice?.active === active ? choice.open : active)) && shown > 0
  const idle = agent.online ? troubleOf(agent) ?? (agent.summary || 'Say hello') : 'Offline'
  const line = lineOf({ working, waiting, idle })
  const [more, setMore] = useState(false)
  const accent = SWATCHES[lookOf(agent).body].shade
  const rows = children.map((child) => <Session key={child.id} gone={child.gone} icon={<I icon={GitBranchIcon} size={12} />} title={child.title} detail="Sub-agent" status={child.status} time={ago(child.startedAt)} accent={accent} />)
  const cut = children.findIndex((_, index) => children.slice(0, index + 1).filter((child) => !child.gone).length > FIRST)
  const toggle = () => setChoice({ active, open: !open })
  return <div className="group relative flex flex-col">
    <RowMenu agent={agent}><a href={agentPath({ agentId: agent.id })} aria-current={active ? 'page' : undefined}
      className={cn('row grid w-full shrink-0 data-popup-open:bg-picked grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-inherit no-underline phone:grid-cols-[52px_1fr_auto] phone:gap-3.5 phone:rounded-2xl phone:px-3 phone:py-3', HOVER, shown > 0 && 'pr-8', !phone && active && !(open && sessions.some((each) => each.id === threadId)) && PICKED)}
      title={agent.online ? undefined : 'Offline'}>
      <span className={cn('relative', !agent.online && 'opacity-45')}><Face agent={agent} size={phone ? 52 : 40} /><Live agent={agent} className="-right-0.5 -bottom-0.5 phone:size-3.5" /></span>
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2"><span className={cn('truncate text-[14px] font-semibold phone:text-[17px]', !agent.online && 'text-mute')}>{agent.name}</span></span>
        <span className={cn('truncate text-[13px]', agent.online ? 'text-body' : 'text-mute', agent.online && !working && troubleOf(agent) && 'text-fail')}>{line}</span>
      </span>
      {thread && <span className="hidden self-start pt-1 text-[12px] text-mute tabular-nums phone:block">{ago(thread.updatedAt)}</span>}
    </a></RowMenu>
    {!open && shown > 0 && <span className="pointer-events-none absolute top-[19px] right-3 flex items-center gap-1.5 text-[11.5px] text-mute-2 tabular-nums transition-opacity group-hover:opacity-0"><Mark status="working" accent={accent} />{working || ''}</span>}
    {shown > 0 && !phone && <Button type="button" variant="bare" aria-label={open ? `Collapse ${agent.name}` : `Expand ${agent.name}`} aria-expanded={open} onClick={toggle}
      className={cn('absolute top-[16px] right-1.5 grid size-6 place-items-center rounded-md text-mute transition-opacity', HOVER, open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
      <I icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} />
    </Button>}
    {open && <div className="flex flex-col gap-0.5 pt-1.5 pb-2 pl-[32px] phone:pl-[48px]">
      {more ? rows : rows.slice(0, cut === -1 ? rows.length : cut)}
      {subagents > FIRST && <Button type="button" variant="bare" onClick={() => setMore(!more)} className={cn('flex h-8 w-full items-center justify-start rounded-md px-2 text-[12.5px] font-normal text-mute', HOVER)}>
        {more ? 'Show less' : `Show ${subagents - FIRST} more`}
      </Button>}
      {sessions.map((each) => <ThreadRow key={each.id} agentId={agent.id} thread={each} accent={accent} active={threadId === each.id} />)}
      {listed.length > sessions.length && <a href={agentPath({ agentId: agent.id, dialog: 'threads' })} className={cn('flex h-8 w-full items-center rounded-md px-2 text-[12.5px] text-mute no-underline', HOVER)}>Show all ({listed.length})</a>}
    </div>}
  </div>
}

type Progress = 'idle' | 'queued' | 'working' | 'review' | 'done' | 'failed'

function lineOf({ working, waiting, idle }: { working: number; waiting: number; idle: string }) {
  if (working) return `Working on ${working} ${working === 1 ? 'task' : 'tasks'}`
  if (waiting) return `${waiting} waiting`
  return idle
}

const SOURCE_ICON = { app: BubbleChatIcon, webhook: WebhookIcon, routine: Clock01Icon }

export function ThreadRow({ agentId, thread, active, accent }: { agentId: string; thread: SourcedThread; active: boolean; accent: string }) {
  const source = sourceOf(thread)
  const live = useLiveLine(thread.id)
  const archive = useArchiveThread(thread)
  const main = thread.id === thread.agentId
  const onArchive = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    archive.mutate(undefined, { onSuccess: () => active && navigate(agentPath({ agentId })), onError: toastError })
  }
  return <div className="group/thread relative">
  <a href={threadRoute({ agentId, threadId: thread.id })} aria-current={active ? 'page' : undefined} title={source.word} className={cn('grid shrink-0 grid-cols-[14px_1fr_auto] items-start gap-x-2 rounded-lg px-2 py-1.5 text-inherit no-underline', HOVER, active && PICKED, !main && 'group-hover/thread:pr-9 group-focus-within/thread:pr-9')}>
    <span className="grid h-[18px] place-items-center text-mute">{source.platform === 'discord' ? <Glyph name="discord" size={13} /> : <I icon={SOURCE_ICON[source.platform]} size={13} />}</span>
    <span className="grid min-w-0">
      <span className="truncate text-[13px]/[18px] font-medium text-ink">{thread.title}</span>
      <span className="flex min-w-0 text-[11.5px]/[16px] text-mute-2 tabular-nums">{live ?? <span className="min-w-0 truncate">{source.label}</span>}<span className="shrink-0 whitespace-pre"> · {ago(thread.updatedAt)}</span></span>
    </span>
    {thread.waiting && <span className={cn('flex h-[18px] items-center gap-1 text-[11.5px] text-ink', !main && 'group-hover/thread:hidden group-focus-within/thread:hidden')}><Mark status="review" accent={accent} />Waiting on you</span>}
  </a>
  {!main && <Button type="button" variant="bare" aria-label={`Archive ${thread.title}`} title="Archive" disabled={archive.isPending} onClick={onArchive}
    className={cn('absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-mute opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100', HOVER)}>
    <I icon={ArchiveIcon} size={14} />
  </Button>}
  </div>
}

const SESSION = 'grid h-8 shrink-0 grid-cols-[14px_1fr_auto] items-center gap-2 overflow-hidden rounded-lg px-2 text-inherit no-underline transition-[height,opacity] duration-500 ease-out'

function Session({ gone, icon, title, detail, status, time, accent }: {
  gone: boolean; icon: ReactElement; title: string; detail: string; status: Progress; time: string; accent: string
}) {
  const body = <>
    <span className="grid place-items-center"><Mark status={status} accent={accent} /></span>
    <span className="min-w-0 truncate text-[13px] font-medium text-ink">{title}</span>
    <span className="flex items-center gap-1.5 text-[11.5px] text-mute-2 tabular-nums"><span className="grid place-items-center">{icon}</span>{time}</span>
  </>
  return <div title={detail} className={cn(SESSION, HOVER, gone && 'h-0 opacity-0')}>{body}</div>
}

const MARK_ICON: Record<Progress, IconSvgElement> = { idle: CircleIcon, queued: DashedLineCircleIcon, working: DashedLineCircleIcon, review: PauseCircleIcon, done: CheckmarkCircle02Icon, failed: CancelCircleIcon }
const MARK_COLOR: Partial<Record<Progress, string>> = { done: 'oklch(62% .13 150)', failed: 'oklch(60% .15 27)' }

function Mark({ status, accent }: { status: Progress; accent: string }) {
  return <span role="img" aria-label={MARK_LABEL[status]} className={cn('grid place-items-center', status === 'working' && 'animate-[spin_3s_linear_infinite] motion-reduce:animate-none', status === 'queued' && 'opacity-45', (status === 'done' || status === 'failed') && 'animate-[pop_.4s_ease-out]')}>
    <HugeiconsIcon icon={MARK_ICON[status]} size={14} strokeWidth={1.8} color={MARK_COLOR[status] ?? (status === 'idle' ? 'currentColor' : accent)} aria-hidden="true" />
  </span>
}

const MARK_LABEL: Record<Progress, string> = { idle: 'Idle', queued: 'Waiting', working: 'Working', review: 'Needs you', done: 'Done', failed: 'Failed' }

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
