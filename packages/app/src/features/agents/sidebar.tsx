import { createContext, useState, type ReactElement } from 'react'
import { Delete02Icon, Logout01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, SidebarLeftIcon, StopIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@/lib/openhut'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, LongPressMenu } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-button'
import { Glyph } from '@/components/glyph'
import { Hut } from '@/components/hut'
import { GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { agentPath } from '@/app/routes'
import type { SourcedThread } from '@/features/threads/places'
import { ThreadMark } from '@/features/threads/thread-list'
import { useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { toneOf, troubleOf, wordOf } from '@/features/agents/status'
import { useSignOut } from '@/features/auth/api'
import { useOwner } from '@/features/people/api'
import { useConnections } from '@/features/connections/api'
import { chipMarks } from '@/features/connections/catalog'
import { UpdateEverything } from '@/features/settings/update-pill'
import { lastSeenOf, personName } from '@/lib/format'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { agentWorking, useAgentsLive } from '@/lib/thread-live'
import { previewOf } from '@/features/agents/progress'

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

export function Sidebar({ contacts, activeId, collapsed, onCollapse, onNew }: {
  contacts: Contact[] | undefined; activeId: string | undefined; collapsed: boolean; onCollapse: () => void; onNew: () => void
}) {
  const phone = useMedia(PHONE)
  return <aside inert={collapsed} className={cn('pushable still shrink-0 overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring)', collapsed ? 'w-0' : 'w-[280px] border-r-[0.5px]', contacts?.length === 0 ? 'phone:hidden' : 'phone:w-full phone:border-r-0', GLASS)}>
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
    <nav className="flex min-h-0 flex-col gap-0.5 overflow-auto px-3 pt-1 phone:gap-0 phone:px-2">
      {!!contacts?.length && <div className="flex flex-col gap-0.5 phone:gap-0">
      {contacts.map(({ agent, threads }) => <AgentRow key={agent.id} agent={agent} threads={threads} active={agent.id === activeId} phone={phone} />)}
      </div>}
      {contacts?.length === 0 && <Button type="button" variant="bare" onClick={onNew} className={cn('grid h-auto w-full grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left font-normal text-inherit', HOVER)}>
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

function AgentRow({ agent, threads, active, phone }: { agent: OpenHutAgent; threads: SourcedThread[]; active: boolean; phone: boolean }) {
  const live = useAgentsLive().get(agent.id)
  const working = agentWorking(live)
  const waiting = live?.activity === 'waiting' || threads.some((each) => each.waiting)
  const preview = previewOf({ agentId: agent.id, summary: agent.summary, threads })
  const trouble = agent.online ? troubleOf(agent) : 'Offline'
  return <RowMenu agent={agent}><a href={agentPath({ agentId: agent.id })} aria-current={active ? 'page' : undefined}
    className={cn('row grid w-full shrink-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-inherit no-underline data-popup-open:bg-picked phone:rounded-2xl', HOVER, !phone && active && PICKED)}
    title={agent.online ? undefined : 'Offline'}>
    <span className={cn('relative grid size-12 place-items-center', !agent.online && 'opacity-45')}>
      <Face agent={agent} size={48} />
      {working
        ? <span className="absolute -right-[3px] -bottom-[3px] grid size-[18px] place-items-center rounded-full bg-card shadow-[0_0_0_1px_var(--hair)]"><ThreadMark status="working" size={14} /></span>
        : <Live agent={agent} className="-right-0.5 -bottom-0.5" />}
    </span>
    <span className="grid min-w-0 gap-[3px]">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('min-w-0 flex-1 truncate text-[14.5px] font-medium', !agent.online && 'text-mute')}>{agent.name}</span>
        {preview.at && <time dateTime={preview.at} className="shrink-0 text-[12.5px] text-mute tabular-nums">{lastSeenOf({ at: preview.at })}</time>}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('min-w-0 flex-1 truncate text-[13px] text-mute', agent.online && trouble && 'text-fail')}>{trouble ?? preview.text}</span>
        {waiting && <i role="img" aria-label="Waiting on you" title="Waiting on you" className="size-2 shrink-0 rounded-full bg-wait" />}
      </span>
    </span>
  </a></RowMenu>
}

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
