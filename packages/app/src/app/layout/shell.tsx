import { useEffect, useRef, useState } from 'react'
import { I, ICON_BUTTON } from '@/components/kit'
import { Settings02Icon } from '@hugeicons/core-free-icons'
import { PhonePage } from '@/app/layout/phone-page'
import { type Route } from '@/app/routes'
import { agentPath } from '@/config/paths'
import { useAgents, useShareLocalFaces } from '@/lib/queries/agents'
import { AgentView } from '@/app/routes/agent'
import { FirstAgent, NewAgentDialog } from '@/features/agents/components/new-agent'
import { NewAgentSteps } from '@/features/models/models-settings'
import { ShowSidebar, Sidebar, type Contact } from '@/app/layout/sidebar'
import { SidebarContext } from '@/lib/layout'
import { useThreads } from '@/features/threads/api/threads'
import { byCreation } from '@/features/agents/progress'
import { PHONE, useMedia } from '@/lib/media'
import { navigate, Redirect } from '@/lib/router'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary'

export type ShellRoute = Extract<Route, { page: 'home' } | { page: 'agent' } | { page: 'missing' }>

export function Shell({ route, overlay }: { route: ShellRoute; overlay: 'settings' | 'connections' | undefined }) {
  const agents = useAgents()
  useShareLocalFaces(agents.data)
  const threads = useThreads()
  const [collapsed, setCollapsed] = useState(savedCollapsed)
  useEffect(() => saveCollapsed(collapsed), [collapsed])
  const phone = useMedia(PHONE)
  const hidden = collapsed && !phone
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
  const contacts: Contact[] = byCreation((agents.data ?? []).map((agent) => ({ agent, threads: threads.data?.filter((thread) => thread.agentId === agent.id) ?? [] })))
  const newAgent = () => navigate(activeId ? agentPath({ agentId: activeId, dialog: 'new' }) : '/new')
  order.current = contacts.map(({ agent }) => agent.id)
  return <SidebarContext value={{ collapsed: hidden }}><div className="relative flex h-dvh overflow-hidden bg-card pt-[env(safe-area-inset-top)] phone:bg-sidebar pb-[env(safe-area-inset-bottom)] text-left">
    {hidden && <ShowSidebar onExpand={() => setCollapsed(false)} onNew={newAgent} />}
    <ErrorBoundary><Sidebar contacts={agents.data && contacts} activeId={activeId} collapsed={hidden} onCollapse={() => setCollapsed((on) => !on)} onNew={newAgent} /></ErrorBoundary>
    <ErrorBoundary key={activeId ?? route.page}>
      {route.page === 'agent' && (phone
        ? <PhonePage key={route.agentId}><AgentView agentId={route.agentId} threadId={route.threadId} dialog={route.dialog} detail={route.detail} /></PhonePage>
        : <AgentView key={route.agentId} agentId={route.agentId} threadId={route.threadId} dialog={route.dialog} detail={route.detail} />)}
      {route.page === 'home' && agents.data && <Home first={contacts[0]?.agent.id} adding={route.adding} overlaid={!!overlay} />}
      {route.page === 'missing' && <Redirect to="/" />}
    </ErrorBoundary>
  </div></SidebarContext>
}

function Home({ first, adding, overlaid }: { first: string | undefined; adding: boolean; overlaid: boolean }) {
  const phone = useMedia(PHONE)
  if (first && phone) return adding ? <NewAgentDialog onClose={() => navigate('/')} modelSteps={NewAgentSteps} /> : null
  if (first && overlaid) return <AgentView key={first} agentId={first} dialog={undefined} detail={undefined} />
  if (first) return <Redirect to={agentPath({ agentId: first, dialog: adding ? 'new' : undefined })} />
  return <section className="relative flex min-w-0 flex-1 flex-col bg-card">
    <PhoneTop />
    <FirstAgent behind={adding || overlaid} modelSteps={NewAgentSteps} />
    {adding && <NewAgentDialog onClose={() => navigate('/')} modelSteps={NewAgentSteps} />}
  </section>
}

function PhoneTop() {
  return <span className="absolute top-3 left-4 hidden items-center gap-1.5 phone:flex">
    <a href="/settings/people" aria-label="Settings" className={cn(ICON_BUTTON, 'float grid size-10 rounded-full bg-card text-ink')}><I icon={Settings02Icon} size={20} /></a>
  </span>
}

const COLLAPSED_KEY = 'openhut.sidebar.collapsed'

function savedCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

function saveCollapsed(collapsed: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { return }
}
