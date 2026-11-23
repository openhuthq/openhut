import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Creature } from '@/components/creature'
import { I, ICON_BUTTON, PILL } from '@/components/kit'
import { Settings02Icon } from '@hugeicons/core-free-icons'
import { PhonePage } from '@/app/phone-page'
import { agentPath, type Route } from '@/app/routes'
import { useAgents, useShareLocalFaces } from '@/features/agents/api'
import { AgentView } from '@/features/agents/agent-view'
import { NewAgentDialog } from '@/features/agents/new-agent'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Hut } from '@/components/hut'
import { nameOf } from '@/features/cloud/api'
import { inWorkspace } from '@/features/cloud/teams'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { HERE } from '@/features/settings/desktop'
import { Sidebar, SidebarContext, type Contact } from '@/features/agents/sidebar'
import { useThreads } from '@/features/threads/api'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, Redirect } from '@/lib/router'
import { cn } from '@/lib/utils'

export type ShellRoute = Extract<Route, { page: 'home' } | { page: 'agent' } | { page: 'missing' }>

export function Shell({ route, overlay }: { route: ShellRoute; overlay: 'settings' | 'connections' | undefined }) {
  const agents = useAgents()
  useShareLocalFaces(agents.data)
  const threads = useThreads()
  const { active } = useWorkspaces()
  const [collapsed, setCollapsed] = useState(false)
  const phone = useMedia(PHONE)
  const order = useRef<string[]>([])
  const activeId = route.page === 'agent' ? route.agentId : undefined
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === '\\') { event.preventDefault(); setCollapsed((on) => !on) }
      const nth = /^[1-9]$/.test(event.key) ? order.current[Number(event.key) - 1] : undefined
      if (nth) { event.preventDefault(); navigate(agentPath({ agentId: nth })) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const contacts: Contact[] = (agents.data ?? [])
    .filter((agent) => inWorkspace({ agent, active }))
    .map((agent) => ({ agent, thread: threads.data?.find((thread) => thread.agentId === agent.id) }))
    .sort((a, b) => lastSeen(b) - lastSeen(a))
  const newAgent = () => navigate(activeId ? agentPath({ agentId: activeId, dialog: 'new' }) : '/new')
  order.current = contacts.map(({ agent }) => agent.id)
  const controls = { collapsed, expand: () => setCollapsed(false), newAgent }
  return <SidebarContext value={controls}><div className="flex h-dvh overflow-hidden bg-card pt-[env(safe-area-inset-top)] phone:bg-sidebar pb-[env(safe-area-inset-bottom)] text-left">
    <Sidebar contacts={contacts} activeId={activeId} collapsed={collapsed} onCollapse={() => setCollapsed((on) => !on)} onNew={newAgent} team={Boolean(active && (active.members.length > 1 || active.invites.length > 0))} />
    {route.page === 'agent' && (phone
      ? <PhonePage key={route.agentId}><AgentView agentId={route.agentId} dialog={route.dialog} detail={route.detail} /></PhonePage>
      : <AgentView key={route.agentId} agentId={route.agentId} dialog={route.dialog} detail={route.detail} />)}
    {route.page === 'home' && agents.data && <Home first={contacts[0]?.agent.id} adding={route.adding} overlaid={!!overlay} waiting={active?.waiting ? active : undefined} />}
    {route.page === 'missing' && <Redirect to="/" />}
  </div></SidebarContext>
}

function Home({ first, adding, overlaid, waiting }: { first: string | undefined; adding: boolean; overlaid: boolean; waiting: CloudWorkspaceView | undefined }) {
  const phone = useMedia(PHONE)
  if (first && phone) return adding ? <NewAgentDialog onClose={() => navigate('/')} /> : null
  if (first && overlaid) return <AgentView key={first} agentId={first} dialog={undefined} detail={undefined} />
  if (first) return <Redirect to={agentPath({ agentId: first, dialog: adding ? 'new' : undefined })} />
  const owner = waiting?.members.find((member) => member.role === 'owner')?.email
  if (waiting) return <section className="relative flex flex-1 flex-col items-center justify-center gap-2 bg-card px-8 pb-12 text-center">
    <PhoneTop />
    <Hut mood="looking" className="size-[84px]" />
    <h1 className="mt-2 mb-0 text-[20px]/[1.3] font-semibold text-ink">Almost in</h1>
    <p className="m-0 text-[14px]/[1.5] text-body">{nameOf(owner ?? '')}’s {HERE} lets you in as soon as it’s on.</p>
  </section>
  return <section className="relative flex flex-1 flex-col items-center justify-center gap-2 bg-card px-8 pb-12 text-center">
    <PhoneTop />
    <Creature id="first-agent" size={64} />
    <h1 className="mt-2 mb-0 text-[20px]/[1.3] font-semibold text-ink">Make your first agent</h1>
    <p className="m-0 text-[14px]/[1.5] text-body">Tell it its job and where to talk to it.</p>
    <Button type="button" variant="primary" className={cn(PILL, 'mt-2 h-8 px-3.5 text-[13px]')} onClick={() => navigate('/new')}>New agent</Button>
    {adding && <NewAgentDialog onClose={() => navigate('/')} />}
  </section>
}

function PhoneTop() {
  return <span className="absolute top-3 left-4 hidden items-center gap-1.5 phone:flex">
    <a href="/settings/general" aria-label="Settings" className={cn(ICON_BUTTON, 'float grid size-10 rounded-full bg-card text-ink')}><I icon={Settings02Icon} size={20} /></a>
  </span>
}

function lastSeen({ agent, thread }: Contact) {
  return Math.max(Date.parse(agent.createdAt), thread ? Date.parse(thread.updatedAt) : 0)
}
