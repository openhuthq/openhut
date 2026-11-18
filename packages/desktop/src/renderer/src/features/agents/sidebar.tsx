import { createContext } from 'react'
import { PlusSignIcon, Settings02Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import type { OpenHutAgent } from '@openhut/client'
import type { Thread } from '@openhut/common/threads/thread.ts'
import { Button } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { DRAG, GLASS, HOVER, I, ICON_BUTTON, PICKED, SURFACE } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { Face } from '@/features/agents/face'
import { toneOf } from '@/features/agents/status'
import { nameOf, useComputers } from '@/features/computers/api'
import { useConnections } from '@/features/connections/api'
import { UpdateEverything } from '@/features/settings/update-pill'
import { cn } from '@/lib/utils'

const LIVE = { on: 'bg-pass', wait: 'animate-[blinkdot_1s_infinite] bg-amber', bad: 'bg-fail', off: 'bg-mute-2' }

export type Contact = { agent: OpenHutAgent; thread: Thread | undefined }

export type SidebarControls = { collapsed: boolean; expand: () => void; newAgent: () => void }
export const SidebarContext = createContext<SidebarControls | null>(null)

export function Sidebar({ contacts, activeId, collapsed, onCollapse, onNew }: {
  contacts: Contact[]; activeId: string | undefined; collapsed: boolean; onCollapse: () => void; onNew: () => void
}) {
  const computers = useComputers().data
  const many = new Set(contacts.map(({ agent }) => agent.computer)).size > 1
  return <aside inert={collapsed} className={cn('shrink-0 overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring)', collapsed ? 'w-0' : 'w-[280px] border-r-[0.5px]', GLASS)}>
    <div className={cn('flex h-full w-[280px] flex-col transition-[opacity,translate] duration-[160ms] ease-out', collapsed && '-translate-x-2 opacity-0')}>
    <div className={cn('flex h-[56px] shrink-0 items-center gap-1.5 pr-3 pl-5', DRAG)}>
      <span className="ml-auto flex gap-1.5">
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="Hide sidebar" title="Hide sidebar ⌘\" onClick={onCollapse}><I icon={SidebarLeftIcon} size={16} /></Button>
        <Button type="button" variant="bare" className={ICON_BUTTON} aria-label="New agent" title="New agent" onClick={onNew}><I icon={PlusSignIcon} size={16} /></Button>
      </span>
    </div>
    <nav className="flex min-h-0 flex-col gap-1 overflow-auto px-3 pt-1">
      {contacts.map(({ agent }) => <a key={agent.id} href={agentPath({ agentId: agent.id })} aria-current={agent.id === activeId ? 'page' : undefined}
        className={cn('grid w-full shrink-0 grid-cols-[40px_1fr] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-inherit no-underline', HOVER, agent.id === activeId && PICKED)}
        title={agent.online ? undefined : `${nameOf({ computers, id: agent.computer })} is offline`}>
        <span className={cn('relative', !agent.online && 'opacity-45')}><Face agent={agent} size={40} /><Live agent={agent} className="-right-0.5 -bottom-0.5" /></span>
        <span className="grid min-w-0 gap-0.5">
          <span className={cn('truncate text-[14px] font-semibold', !agent.online && 'text-mute')}>{agent.name}</span>
          <span className={cn('truncate text-[13px]', agent.online ? 'text-body' : 'text-mute')}>{many && `${nameOf({ computers, id: agent.computer })} · `}{agent.online ? agent.summary || 'Say hello' : 'Offline'}</span>
        </span>
      </a>)}
      {!contacts.length && <p className="m-0 px-2.5 py-2 text-[13px] text-mute">No agents yet</p>}
    </nav>
    <footer className="mt-auto flex flex-col items-start gap-2 px-3 pt-2 pb-3">
      <UpdateEverything />
      <div className="flex w-full items-center gap-2">
        <Gear />
        <a href="/connections" className={cn(SURFACE, 'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg pr-3 pl-3.5 text-[13.5px] font-medium')}>
          <ConnectedMarks />
        </a>
      </div>
    </footer>
    </div>
  </aside>
}

function Gear() {
  return <a href="/settings/general" aria-label="Settings" title="Settings ⌘," className={cn(SURFACE, 'grid size-10 shrink-0 place-items-center rounded-lg')}><I icon={Settings02Icon} size={17} /></a>
}

function Live({ agent, className }: { agent: OpenHutAgent; className: string }) {
  const tone = toneOf(agent)
  return <i title={agent.status} className={cn('absolute size-3 rounded-full border-2 border-sidebar', LIVE[tone], className)} />
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
