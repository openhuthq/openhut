import type { Agent } from '@openhut/common/agents/agent.ts'
import { SidebarGroupLabel, SidebarMenuButton } from '@/components/ui/sidebar'
import { Creature } from '@/components/creature'
import { agentState } from '@/components/status-badge'
import type { Route } from '@/app/routes'
import { useAgents } from '@/features/agents/api'
import { cn } from '@/lib/utils'

const DOT = {
  ok: 'bg-pass',
  wait: 'animate-[blinkdot_1s_infinite] bg-amber',
  bad: 'bg-fail',
  off: 'bg-transparent shadow-[inset_0_0_0_1.5px_var(--mute-2)]',
}

export function ChatTree({ route }: { route: Route }) {
  const agents = useAgents()
  if (!agents.data?.length) return null
  const openId = route.page === 'chat' ? route.agentId : undefined
  return <div className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-auto px-2">
    <SidebarGroupLabel>Chats</SidebarGroupLabel>
    {agents.data.map((agent) => <SidebarMenuButton key={agent.id} href={`/agents/${agent.id}/chat`} aria-current={agent.id === openId ? 'page' : undefined}>
      <Creature id={agent.id} about={agent.instructions} size={26} /><span className="truncate">{agent.name}</span><i className={cn('size-[7px] shrink-0 rounded-full', DOT[dotOf(agent)])} title={agentState(agent)} />
    </SidebarMenuButton>)}
  </div>
}

function dotOf(agent: Agent) {
  switch (agentState(agent)) {
    case 'running': return 'ok'
    case 'starting': return 'wait'
    case 'not_answering':
    case 'no_seat':
    case 'missing': return 'bad'
    case 'stopped': return 'off'
  }
}
