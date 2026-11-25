import { createContext, useState, useSyncExternalStore, type ReactElement } from 'react'
import { BrowserIcon, Cancel01Icon, Logout03Icon, Delete02Icon, LaptopIcon, Link01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, ServerStack01Icon, SidebarLeftIcon, StopIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@/lib/openhut'
import { CreditsLine } from '@/features/credits/credits'
import type { Thread } from '@openhut/common/threads/thread.ts'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, LongPressMenu } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-button'
import { Glyph } from '@/components/glyph'
import { Hut } from '@/components/hut'
import { TeamMark } from '@/components/custom/team-mark'
import { DRAG, GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { chooseWorkspace, continueInWeb, peopleNote, useWorkspaces } from '@/features/cloud/workspaces'
import { REMOTE } from '@/lib/remote'
import { shownTeams } from '@/features/cloud/shown-teams'
import { nameOf as personName, useCloud, useSignOut } from '@/features/cloud/api'
import { SIGN_OUT_DETAIL } from '@/features/cloud/cloud'
import { PersonFace } from '@/components/custom/person-face'
import { dismissGone, dismissedGone, onGoneDismissed, removedLine } from '@/features/cloud/seen'
import { Faces } from '@/features/cloud/presence'
import { agentPath } from '@/app/routes'
import { useAgents, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { toneOf, troubleOf, wordOf } from '@/features/agents/status'
import { nameOf, useComputers } from '@/features/computers/api'
import { useConnections } from '@/features/connections/api'
import { chipMarks } from '@/features/connections/catalog'
import { UpdateEverything } from '@/features/settings/update-pill'
import { ago } from '@/lib/format'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { desktop } from '@/lib/desktop'
import { cn } from '@/lib/utils'

const ROUND = 'float phone:size-10 phone:rounded-full phone:bg-card phone:text-ink'

const LABEL = 'px-2.5 pt-3 pb-1 text-[11.5px] font-medium text-mute'

const LIVE = { on: 'bg-pass', wait: 'animate-[blinkdot_1s_infinite] bg-amber', bad: 'bg-fail', off: 'bg-mute-2' }

export type Contact = { agent: OpenHutAgent; thread: Thread | undefined }

export const SidebarContext = createContext<{ collapsed: boolean } | null>(null)

export function ShowSidebar({ onExpand, onNew }: { onExpand: () => void; onNew: () => void }) {
  return <span className={cn('absolute top-[env(safe-area-inset-top)] left-0 z-10 flex h-[52px] items-center gap-0.5 pl-3 mac:pl-[84px] phone:hidden animate-[fadein_120ms_80ms_ease-out_backwards]', DRAG)}>
    <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Show sidebar" title="Show sidebar ⌘\" onClick={onExpand}><I icon={SidebarLeftIcon} size={16} /></Button>
    <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={16} /></Button>
  </span>
}

export function Sidebar({ contacts, activeId, collapsed, onCollapse, onNew, team }: {
  contacts: Contact[]; activeId: string | undefined; collapsed: boolean; onCollapse: () => void; onNew: () => void; team: boolean
}) {
  const computers = useComputers().data
  const phone = useMedia(PHONE)
  const many = new Set(contacts.map(({ agent }) => agent.computer)).size > 1
  return <aside inert={collapsed} className={cn('pushable still shrink-0 overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring)', collapsed ? 'w-0' : 'w-[280px] border-r-[0.5px]', contacts.length ? 'phone:w-full phone:border-r-0' : 'phone:hidden', GLASS)}>
    <div className={cn('flex h-full w-[280px] flex-col phone:w-full transition-[opacity,translate] duration-[160ms] ease-out', collapsed && '-translate-x-2 opacity-0')}>
    <div className={cn('flex h-[44px] shrink-0 items-center gap-1.5 pr-3 pl-3 mac:pl-[84px] phone:h-16 phone:px-4', DRAG)}>
      <a href="/" aria-label="OpenHut" title="OpenHut" className="flex items-center gap-1.5 text-[14px] font-semibold text-ink no-underline phone:hidden"><Hut className="size-6" />OpenHut</a>
      <a href="/settings/general" aria-label="Settings" className={cn(ICON_BUTTON, ROUND, 'hidden phone:grid')}><I icon={Settings02Icon} size={20} /></a>
      <span className="ml-auto flex gap-1.5">
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, 'phone:hidden')} aria-label="Hide sidebar" title="Hide sidebar ⌘\" onClick={onCollapse}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, ROUND)} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={phone ? 20 : 16} /></Button>
      </span>
    </div>
    <h1 className="m-0 hidden px-5 pt-1 pb-3 text-[32px]/[1.1] font-bold tracking-[-.02em] phone:block">Agents</h1>
    <nav className="flex min-h-0 flex-col gap-1 overflow-auto px-3 pt-1 phone:gap-0 phone:px-2">
      {(team ? [['Shared', contacts.filter(({ agent }) => (agent.shared || agent.people.length > 0) && agent.inSidebar)], ['Private', contacts.filter(({ agent }) => !agent.shared && !agent.people.length)], ['More on your team', contacts.filter(({ agent }) => !agent.inSidebar)]] as const : [['', contacts]] as const).map(([label, group]) => group.length > 0 && <div key={label} className="flex flex-col gap-1 phone:gap-0">
      {label && <span className={LABEL}>{label}</span>}
      {group.map(({ agent, thread }) => <RowMenu key={agent.id} agent={agent}><a href={agentPath({ agentId: agent.id })} aria-current={agent.id === activeId ? 'page' : undefined}
        className={cn('row grid w-full shrink-0 data-popup-open:bg-picked grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-inherit no-underline phone:grid-cols-[52px_1fr_auto] phone:gap-3.5 phone:rounded-2xl phone:px-3 phone:py-3', HOVER, !phone && agent.id === activeId && PICKED)}
        title={agent.online ? undefined : `${nameOf({ computers, id: agent.computer })} is offline`}>
        <span className={cn('relative', !agent.online && 'opacity-45')}><Face agent={agent} size={phone ? 52 : 40} /><Live agent={agent} className="-right-0.5 -bottom-0.5 phone:size-3.5" /></span>
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2"><span className={cn('truncate text-[14px] font-semibold phone:text-[17px]', !agent.online && 'text-mute')}>{agent.name}</span><span className="ml-auto flex shrink-0 items-center gap-1.5">{agent.shared && <Faces agentId={agent.id} size={18} />}<Where agent={agent} computers={computers} /></span></span>
          <span className={cn('truncate text-[13px]', agent.online ? 'text-body' : 'text-mute', agent.online && troubleOf(agent) && 'text-fail')}>{many && `${nameOf({ computers, id: agent.computer })} · `}{agent.online ? troubleOf(agent) ?? (agent.summary || 'Say hello') : 'Offline'}</span>
        </span>
        {thread && <span className="hidden self-start pt-1 text-[12px] text-mute tabular-nums phone:block">{ago(thread.updatedAt)}</span>}
      </a></RowMenu>)}
      </div>)}
      {!contacts.length && <Button type="button" variant="bare" onClick={onNew} className={cn('grid h-auto w-full grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left font-normal text-inherit', HOVER)}>
        <span className="grid size-10 place-items-center rounded-[24%] border-[1.5px] border-dashed border-mute-2 text-mute"><I icon={PlusSignIcon} size={16} /></span>
        <span className="grid min-w-0 gap-0.5"><span className="truncate text-[14px] font-semibold">New agent</span><span className="truncate text-[13px] text-body">Make your first agent</span></span>
      </Button>}
    </nav>
    <footer className="mt-auto flex flex-col items-start gap-2 px-3 pt-2 pb-3">
      <UpdateEverything />
      <RemovedLine />
      <CreditsLine />
      <div className="flex w-full items-center gap-2">
        <TeamSwitcher />
        <a href="/connections" className={cn(SURFACE, 'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg pr-3 pl-3.5 text-[13.5px] font-medium')}>
          <ConnectedMarks />
        </a>
        <Gear />
      </div>
    </footer>
    </div>
  </aside>
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
  return <a href="/settings/general" aria-label="Settings" title={desktop ? 'Settings ⌘,' : 'Settings'} className={cn(SURFACE, 'grid phone:hidden size-10 shrink-0 place-items-center rounded-lg')}><I icon={Settings02Icon} size={17} /></a>
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

function RemovedLine() {
  const dismissed = useSyncExternalStore(onGoneDismissed, dismissedGone)
  const line = removedLine({ gone: useCloud().data?.gone ?? [], dismissed: JSON.parse(dismissed) as string[] })
  if (!line) return null
  return <p role="status" className="m-0 flex w-full items-center gap-2 rounded-lg bg-soft px-3 py-2 text-[12.5px]/[1.4] text-body">
    <span className="min-w-0 flex-1">{line.text}</span>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" onClick={() => dismissGone(line.key)}><I icon={Cancel01Icon} size={14} /></Button>
  </p>
}

function TeamSwitcher() {
  const { all, active, email } = useWorkspaces()
  const signOut = useSignOut()
  const [leaving, setLeaving] = useState(false)
  const homeAgents = (useAgents().data ?? []).filter((agent) => !agent.workspace).length
  const teams = shownTeams({ all, active: active.id, homeAgents })
  const name = personName(email ?? '')
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="bare" aria-label={`You: ${name}, team ${active.name}`} title={`${name} · ${active.name}`} className={cn(SURFACE, 'relative grid size-10 shrink-0 place-items-center rounded-lg')} />}>
        <PersonFace name={name} email={email ?? ''} size={24} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="flex w-[260px] flex-col gap-0.5 rounded-lg p-1.5 shadow-menu">
        <div className="flex items-center gap-2.5 px-2 py-1.5"><PersonFace name={name} email={email ?? ''} size={28} /><span className="grid min-w-0 leading-tight"><span className="truncate text-[13px] font-medium">{name}</span><span className="truncate text-[11.5px] text-mute">{email}</span></span></div>
        <DropdownMenuSeparator />
        {teams.map((workspace) => <DropdownMenuItem key={workspace.id} className="h-auto gap-2.5 px-2 py-1.5" onClick={() => { if (workspace.id !== active.id) { chooseWorkspace(workspace.id); navigate('/') } }}>
          <TeamMark workspace={workspace} className="size-7 rounded-md text-[12px]" />
          <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate text-[13px] font-medium">{workspace.name}</span><span className="text-[11.5px] text-mute">{peopleNote(workspace)}</span></span>
          {workspace.id === active.id && <I icon={Tick02Icon} size={14} />}
        </DropdownMenuItem>)}
        <DropdownMenuItem className="h-8 gap-2.5 px-2 text-[13px]" onClick={() => open('join-link')}><I icon={Link01Icon} size={15} className="text-mute" />Join a team</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8 gap-2.5 px-2 text-[13px]" onClick={() => navigate('/settings/general')}><I icon={Settings02Icon} size={15} className="text-mute" />Settings{desktop && <span className="ml-auto text-[12px] text-mute">⌘,</span>}</DropdownMenuItem>
        {!REMOTE && <DropdownMenuItem className="h-8 gap-2.5 px-2 text-[13px]" onClick={() => void continueInWeb().catch(toastError)}><I icon={BrowserIcon} size={15} className="text-mute" />Continue in web</DropdownMenuItem>}
        <DropdownMenuItem className="h-8 gap-2.5 px-2 text-[13px]" onClick={() => setLeaving(true)}><I icon={Logout03Icon} size={15} className="text-mute" />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog open={leaving} onOpenChange={setLeaving} question="Sign out?" detail={SIGN_OUT_DETAIL} action="Sign out" onConfirm={() => signOut.mutateAsync()} />
  </>
}

function Where({ agent, computers }: { agent: OpenHutAgent; computers: Parameters<typeof nameOf>[0]['computers'] }) {
  const label = agent.runsHere ? 'Runs on this computer' : `Runs on ${agent.runsOnName ?? nameOf({ computers, id: agent.computer })}`
  return <Tooltip label={label}><span aria-label={label} className="grid text-mute-2"><I icon={agent.runsOnServer ? ServerStack01Icon : LaptopIcon} size={13} /></span></Tooltip>
}
