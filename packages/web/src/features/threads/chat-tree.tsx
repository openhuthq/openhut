import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { Avatar } from '@/components/avatar'
import { agentState } from '@/components/status-badge'
import type { Route } from '@/app/routes'
import { useAgents } from '@/features/agents/api'

export function ChatTree({ route }: { route: Route }) {
  const agents = useAgents()
  if (!agents.data?.length) return null
  const openId = route.page === 'chat' ? route.agentId : undefined
  return <div className="chats">
    <div className="sidelabel">Chats</div>
    {agents.data.map((agent) => <a key={agent.id} className="nav chat-agent" href={`/agents/${agent.id}/chat`} aria-current={agent.id === openId ? 'page' : undefined}>
      <Avatar id={agent.id} about={agent.instructions} size={20} /><span className="ellip">{agent.name}</span><i className={`dot ${dotOf(agent)}`} title={agentState(agent)} />
    </a>)}
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
