import { createContext, useState, type ReactElement } from 'react'
import { Delete02Icon, Message01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, SidebarLeftIcon, StopIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@openhut/client'
import type { Thread } from '@openhut/common/threads/thread.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, LongPressMenu } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/confirm-button'
import { Glyph } from '@/components/glyph'
import { TeamMark } from '@/components/custom/team-mark'
import { DRAG, GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { BackupCard } from '@/features/cloud/backup-card'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { Faces } from '@/features/cloud/presence'
import { agentPath } from '@/app/routes'
import { useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { toneOf, troubleOf, wordOf } from '@/features/agents/status'
import { nameOf, useComputers } from '@/features/computers/api'
import { useConnections } from '@/features/connections/api'
import { UpdateEverything } from '@/features/settings/update-pill'
import { ago } from '@/lib/format'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROUND = 'float phone:size-10 phone:rounded-full phone:bg-card phone:text-ink'

const LABEL = 'px-2.5 pt-3 pb-1 text-[11.5px] font-medium text-mute'

const EMPTY = 'm-0 px-2.5 py-2 text-[13px] text-mute'

const LIVE = { on: 'bg-pass', wait: 'animate-[blinkdot_1s_infinite] bg-amber', bad: 'bg-fail', off: 'bg-mute-2' }

export type Contact = { agent: OpenHutAgent; thread: Thread | undefined }

export type SidebarControls = { collapsed: boolean; expand: () => void; newAgent: () => void }
export const SidebarContext = createContext<SidebarControls | null>(null)

export function Sidebar({ contacts, activeId, collapsed, onCollapse, onNew, team }: {
  contacts: Contact[]; activeId: string | undefined; collapsed: boolean; onCollapse: () => void; onNew: () => void; team: boolean
}) {
  const computers = useComputers().data
  const phone = useMedia(PHONE)
  const many = new Set(contacts.map(({ agent }) => agent.computer)).size > 1
  const { active } = useWorkspaces()
  return <aside inert={collapsed} className={cn('pushable still shrink-0 overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring)', collapsed ? 'w-0' : 'w-[280px] border-r-[0.5px]', contacts.length ? 'phone:w-full phone:border-r-0' : 'phone:hidden', GLASS)}>
    <div className={cn('flex h-full w-[280px] flex-col phone:w-full transition-[opacity,translate] duration-[160ms] ease-out', collapsed && '-translate-x-2 opacity-0')}>
    <div className={cn('flex h-[44px] shrink-0 items-center gap-1.5 pr-3 pl-3 phone:h-16 phone:px-4', DRAG)}>
      <a href="/settings/general" aria-label="Settings" className={cn(ICON_BUTTON, ROUND, 'hidden phone:grid')}><I icon={Settings02Icon} size={20} /></a>
      <span className="ml-auto flex gap-1.5">
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, 'phone:hidden')} aria-label="Hide sidebar" title="Hide sidebar ⌘\" onClick={onCollapse}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={cn(ICON_BUTTON, ROUND)} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={phone ? 20 : 16} /></Button>
      </span>
    </div>
    <h1 className="m-0 hidden px-5 pt-1 pb-3 text-[32px]/[1.1] font-bold tracking-[-.02em] phone:block">Agents</h1>
    <nav className="flex min-h-0 flex-col gap-1 overflow-auto px-3 pt-1 phone:gap-0 phone:px-2">
      {(team ? [['Shared', contacts.filter(({ agent }) => agent.shared)], ['Private', contacts.filter(({ agent }) => !agent.shared)]] as const : [['', contacts]] as const).map(([label, group]) => group.length > 0 && <div key={label} className="flex flex-col gap-1 phone:gap-0">
      {label && <span className={LABEL}>{label}</span>}
      {group.map(({ agent, thread }) => <RowMenu key={agent.id} agent={agent}><a href={agentPath({ agentId: agent.id })} aria-current={agent.id === activeId ? 'page' : undefined}
        className={cn('row grid w-full shrink-0 data-popup-open:bg-picked grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-inherit no-underline phone:grid-cols-[52px_1fr_auto] phone:gap-3.5 phone:rounded-2xl phone:px-3 phone:py-3', HOVER, !phone && agent.id === activeId && PICKED)}
        title={agent.online ? undefined : `${nameOf({ computers, id: agent.computer })} is offline`}>
        <span className={cn('relative', !agent.online && 'opacity-45')}><Face agent={agent} size={phone ? 52 : 40} /><Live agent={agent} className="-right-0.5 -bottom-0.5 phone:size-3.5" /></span>
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2"><span className={cn('truncate text-[14px] font-semibold phone:text-[17px]', !agent.online && 'text-mute')}>{agent.name}</span>{agent.shared && <span className="ml-auto shrink-0"><Faces agentId={agent.id} size={18} /></span>}</span>
          <span className={cn('truncate text-[13px]', agent.online ? 'text-body' : 'text-mute', agent.online && troubleOf(agent) && 'text-fail')}>{many && `${nameOf({ computers, id: agent.computer })} · `}{agent.online ? troubleOf(agent) ?? (agent.summary || 'Say hello') : 'Offline'}</span>
        </span>
        {thread && <span className="hidden self-start pt-1 text-[12px] text-mute tabular-nums phone:block">{ago(thread.updatedAt)}</span>}
      </a></RowMenu>)}
      </div>)}
      {!contacts.length && <p className={EMPTY}>No agents yet</p>}
    </nav>
    <footer className="mt-auto flex flex-col items-start gap-2 px-3 pt-2 pb-3">
      <BackupCard />
      <UpdateEverything />
      <div className="flex w-full items-center gap-2">
        {active && <a href="/settings/team" aria-label="Team settings" title={active.name} className={cn(SURFACE, 'grid size-10 shrink-0 place-items-center rounded-lg')}><TeamMark name={active.name} /></a>}
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
      {agent.canEdit && <DropdownMenuItem disabled={!agent.online} onClick={() => update.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} />{running ? `Stop ${agent.name}` : `Start ${agent.name}`}</DropdownMenuItem>}
      {agent.canEdit && agent.canManage && <DropdownMenuItem variant="destructive" disabled={!agent.online} onClick={() => setDeleting(true)}><I icon={Delete02Icon} size={16} />Delete {agent.name}…</DropdownMenuItem>}
    </>}>{children}</LongPressMenu>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} question={`Delete ${agent.name}?`} detail="Its chats, memory and skills go with it." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })} />
  </>
}

function Gear() {
  return <a href="/settings/general" aria-label="Settings" title="Settings ⌘," className={cn(SURFACE, 'grid phone:hidden size-10 shrink-0 place-items-center rounded-lg')}><I icon={Settings02Icon} size={17} /></a>
}

function Live({ agent, className }: { agent: OpenHutAgent; className: string }) {
  const tone = toneOf(agent)
  return <i title={wordOf(agent)} className={cn('absolute size-3 rounded-full border-2 border-sidebar', LIVE[tone], className)} />
}

const SUGGESTED = ['gmail', 'drive', 'postgres'] as const

function ConnectedMarks() {
  const connections = useConnections()
  const connected = [...new Set(connections.data?.map((connection) => connection.kind))].slice(0, 3)
  const kinds = connected.length ? connected : SUGGESTED
  return <>
    <span className="truncate">{connections.data && !connected.length ? 'Connect apps' : 'Connections'}</span>
    <span className="ml-auto flex shrink-0 gap-1">{kinds.map((kind) => <Glyph key={kind} name={kind} size={14} />)}</span>
  </>
}
