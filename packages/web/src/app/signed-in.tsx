import { useState } from 'react'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { ICONS, NAV_ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Monkey } from '@/components/monkey'
import { Page, SidebarToggle } from '@/components/page'
import type { Route } from '@/app/routes'
import { AdminPage } from '@/features/admin/admin-page'
import { AgentPage } from '@/features/agents/agent-page'
import { AgentsPage } from '@/features/agents/agents-page'
import { useAgents } from '@/features/agents/api'
import { ChatTree } from '@/features/threads/chat-tree'
import { useThreads } from '@/features/threads/api'
import { NewThreadPage, ThreadPage } from '@/features/threads/thread-page'
import { useDeleteSession } from '@/features/auth/api'
import { ConnectionPage } from '@/features/connections/connection-page'
import { ConnectionsPage } from '@/features/connections/connections-page'
import { TailscalePage } from '@/features/connections/tailscale-page'
import { PeoplePage } from '@/features/people/people-page'
import { ROLE_LABEL } from '@/lib/roles'
import { Redirect } from '@/lib/router'
import { toastError } from '@/lib/toast'

type Section = keyof typeof NAV_ICONS

const SECTION_OF: Partial<Record<Route['page'], Section>> = {
  agents: 'agents', agent: 'agents',
  connections: 'connections', tailscale: 'connections', connection: 'connections',
  people: 'people',
  admin: 'admin',
}

export function SignedIn({ me, route }: { me: Me; route: Route }) {
  const agents = useAgents()
  const deleteSession = useDeleteSession()
  const [collapsed, setCollapsed] = useState(false)
  const current = SECTION_OF[route.page]
  return <SidebarToggle value={() => setCollapsed(!collapsed)}>
    <div className={collapsed ? 'app collapsed' : 'app'}>
      <aside className="side" aria-label="Sidebar">
        <div className="team"><Monkey className="monkey logo" /><div className="teamname">Fast Monkey</div></div>
        <NavLink section="agents" label="Agents" current={current} count={agents.data?.length} />
        <NavLink section="connections" label="Connections" current={current} />
        <ChatTree route={route} />
        <div className="sidefoot">
          <NavLink section="people" label="People" current={current} />
          <NavLink section="admin" label="Admin" current={current} />
        </div>
        <div className="me">
          <Initial id={me.user.id} email={me.user.email} />
          <div className="who"><div className="ellip">{me.user.email}</div><div className="mute">{ROLE_LABEL[me.user.role]}</div></div>
          <button type="button" className="btn ghost sm tight" aria-label="Sign out" title="Sign out" disabled={deleteSession.isPending} onClick={() => deleteSession.mutate(undefined, { onError: toastError })}>{ICONS.out}</button>
        </div>
      </aside>
      <main className="panel"><RoutePage me={me} route={route} /></main>
    </div>
  </SidebarToggle>
}

function NavLink({ section, label, current, count }: { section: Section; label: string; current: Section | undefined; count?: number }) {
  return <a className="nav" href={`/${section}`} aria-current={section === current ? 'page' : undefined}>
    {NAV_ICONS[section]}{label}{count !== undefined && <span className="count">{count}</span>}
  </a>
}

function RoutePage({ me, route }: { me: Me; route: Route }) {
  switch (route.page) {
    case 'home': return <Home />
    case 'new-thread': return <NewThreadPage key={route.agentId} me={me} agentId={route.agentId} />
    case 'thread': return <ThreadPage key={route.threadId} me={me} threadId={route.threadId} />
    case 'agents': return <AgentsPage me={me} />
    case 'agent': return <AgentPage key={route.agentId} agentId={route.agentId} dialog={route.dialog} />
    case 'connections': return <ConnectionsPage me={me} adding={route.adding} />
    case 'tailscale': return <TailscalePage me={me} />
    case 'connection': return <ConnectionPage key={route.connectionId} me={me} connectionId={route.connectionId} />
    case 'people': return <PeoplePage me={me} inviting={route.inviting} />
    case 'admin': return <AdminPage me={me} form={route.form} />
    default: return <Page title="Not found"><div className="empty"><Avatar id="lost" size={96} /><div>Nothing here</div></div></Page>
  }
}

function Home() {
  const threads = useThreads()
  const agents = useAgents()
  if (!threads.data || !agents.data) return null
  const [latest] = threads.data
  if (latest) return <Redirect to={`/threads/${latest.id}`} />
  const [first] = agents.data
  return <Redirect to={first ? `/agents/${first.id}/chat` : '/agents'} />
}
