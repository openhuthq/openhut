import { agentPath, routeOf } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { useAgents } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { nameOf } from '@/features/cloud/api'
import { EntryScreen, Stage } from '@/features/cloud/step'
import { Chat } from '@/features/threads/chat'
import { navigate, usePath } from '@/lib/router'
import { cn } from '@/lib/utils'

export function Teammate() {
  const agents = useAgents()
  const route = routeOf(usePath())
  const shared = agents.data ?? []
  const agent = shared.find((each) => route.page === 'agent' && each.id === route.agentId) ?? shared.find((each) => each.inSidebar) ?? shared[0]
  if (agents.error) return <Stage><EntryScreen mood="worried" title="Can’t reach your team’s computer." line={agents.error.message} /></Stage>
  if (!agents.data) return <Stage><EntryScreen mood="looking" title="Opening your team…" waiting="Opening" /></Stage>
  if (!agent) return <Stage><EntryScreen title="Nothing is shared with you yet." line="When your team shares an agent with you, you chat with it here." /></Stage>
  return <div className="flex h-dvh overflow-hidden bg-card text-left">
    <nav aria-label="Shared agents" className="flex w-[240px] shrink-0 flex-col gap-1 bg-sidebar p-3 phone:hidden">
      {[['Shared with you', shared.filter((each) => each.inSidebar)], ['More on your team', shared.filter((each) => !each.inSidebar)]].map(([label, group]) => group.length > 0 && <div key={label as string} className="flex flex-col gap-1">
      <p className="m-0 px-2 pt-2 pb-1 text-[12px] font-medium text-mute">{label as string}</p>
      {(group as typeof shared).map((each) => <Button key={each.id} type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: each.id }))}
        className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px]', each.id === agent.id ? 'bg-card font-semibold text-ink' : 'text-body')}>
        <Face agent={each} size={24} /><span className="grid min-w-0"><span className="truncate">{each.name}</span><span className="truncate text-[11.5px] font-normal text-mute">Shared by {nameOf(each.owner ?? '')}</span></span>
      </Button>)}
      </div>)}
    </nav>
    <Chat key={agent.id} agent={agent} />
  </div>
}
