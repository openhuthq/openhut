import { useEffect } from 'react'
import type { Me } from '@openhut/common/team/team.ts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty } from '@/components/ui/empty'
import { Sidebar, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenuBadge, SidebarMenuButton, SidebarProvider } from '@/components/ui/sidebar'
import { Creature } from '@/components/creature'
import { ICONS, NAV_ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Hut } from '@/components/hut'
import { Page } from '@/components/page'
import type { Route } from '@/app/routes'
import { track } from '@/lib/track'
import { AdminPage } from '@/features/admin/admin-page'
import { AgentPage } from '@/features/agents/agent-page'
import { AgentsPage } from '@/features/agents/agents-page'
import { useAgents } from '@/features/agents/api'
import { ChatTree } from '@/features/threads/chat-tree'
import { AgentChatPage } from '@/features/threads/thread-page'
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
  const current = SECTION_OF[route.page]
  useEffect(() => track({ name: 'dashboard_page_viewed', properties: { page: route.page } }), [route.page])
  return <SidebarProvider>
    <Sidebar aria-label="Sidebar">
      <SidebarHeader><Hut className="size-7 rounded-[7px] bg-ink p-0.5 group-hover/team:[&>svg]:animate-hop" /><div className="font-brand text-[19px]/none font-semibold tracking-[-.01em]">OpenHut</div></SidebarHeader>
      <NavLink section="agents" label="Agents" current={current} count={agents.data?.length} />
      <NavLink section="connections" label="Connections" current={current} />
      <ChatTree route={route} />
      <SidebarFooter>
        <NavLink section="people" label="People" current={current} />
        <NavLink section="admin" label="Admin" current={current} />
      </SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-12 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-sm/[1.3] hover:bg-tint data-popup-open:bg-tint">
          <Initial id={me.user.id} email={me.user.email} />
          <Who email={me.user.email} role={ROLE_LABEL[me.user.role]} />
          <span className="text-mute">{ICONS.updown}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <Initial id={me.user.id} email={me.user.email} size={32} />
              <Who email={me.user.email} role={ROLE_LABEL[me.user.role]} />
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={deleteSession.isPending} onClick={() => deleteSession.mutate(undefined, { onError: toastError })}>{ICONS.out}Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Sidebar>
    <SidebarInset><RoutePage me={me} route={route} /></SidebarInset>
  </SidebarProvider>
}

function Who({ email, role }: { email: string; role: string }) {
  return <span className="grid min-w-0 flex-1"><span className="truncate">{email}</span><span className="truncate text-mute">{role}</span></span>
}

function NavLink({ section, label, current, count }: { section: Section; label: string; current: Section | undefined; count?: number }) {
  return <SidebarMenuButton href={`/${section}`} aria-current={section === current ? 'page' : undefined}>
    {NAV_ICONS[section]}{label}{count !== undefined && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
  </SidebarMenuButton>
}

function RoutePage({ me, route }: { me: Me; route: Route }) {
  switch (route.page) {
    case 'home': return <Home />
    case 'chat': return <AgentChatPage key={route.agentId} me={me} agentId={route.agentId} />
    case 'agents': return <AgentsPage me={me} />
    case 'agent': return <AgentPage key={route.agentId} agentId={route.agentId} dialog={route.dialog} skill={route.skill} automation={route.automation} />
    case 'connections': return <ConnectionsPage me={me} adding={route.adding} />
    case 'tailscale': return <TailscalePage me={me} />
    case 'connection': return <ConnectionPage key={route.connectionId} me={me} connectionId={route.connectionId} />
    case 'people': return <PeoplePage me={me} inviting={route.inviting} />
    case 'admin': return <AdminPage me={me} form={route.form} />
    default: return <Page title="Not found"><Empty><Creature id="lost" size={96} /><div>Nothing here</div></Empty></Page>
  }
}

function Home() {
  const agents = useAgents()
  if (!agents.data) return null
  const [first] = agents.data
  return <Redirect to={first ? `/agents/${first.id}/chat` : '/agents'} />
}
