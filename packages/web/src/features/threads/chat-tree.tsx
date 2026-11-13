import { Fragment, useState } from 'react'
import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { Avatar } from '@/components/avatar'
import { agentState } from '@/components/status-badge'
import type { Route } from '@/app/routes'
import { useAgents } from '@/features/agents/api'
import { useThreads } from '@/features/threads/api'
import { ago } from '@/lib/format'

const SHOWN = 3

export function ChatTree({ route }: { route: Route }) {
  const agents = useAgents()
  const threads = useThreads()
  const [more, setMore] = useState(false)
  const threadId = route.page === 'thread' ? route.threadId : undefined
  const openId = route.page === 'new-thread' || route.page === 'agent' ? route.agentId : threads.data?.find((thread) => thread.id === threadId)?.agentId
  if (!agents.data?.length) return null
  return <div className="chats">
    <div className="sidelabel">Chats</div>
    {agents.data.map((agent) => {
      const mine = threads.data?.filter((thread) => thread.agentId === agent.id) ?? []
      const open = agent.id === openId
      return <Fragment key={agent.id}>
        <a className={open ? 'nav chat-agent open' : 'nav chat-agent'} href={`/agents/${agent.id}/chat`} title={`New thread with ${agent.name}`}>
          <Avatar id={agent.id} about={agent.instructions} size={20} /><span className="ellip">{agent.name}</span><i className={`dot ${dotOf(agent)}`} title={agentState(agent)} /><span className="count">{mine.length || ''}</span>
        </a>
        {open && <div className="threads">
          {route.page === 'new-thread' && <span className="thread" aria-current="page"><span className="ellip">New thread</span></span>}
          {(more ? mine : mine.slice(0, SHOWN)).map((thread) => <a className="thread" href={`/threads/${thread.id}`} key={thread.id} aria-current={thread.id === threadId ? 'page' : undefined}>
            <span className="ellip">{thread.title}</span><time dateTime={thread.updatedAt}>{ago(thread.updatedAt)}</time>
          </a>)}
          {mine.length > SHOWN && <button type="button" className="thread more" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show ${mine.length - SHOWN} more`}</button>}
        </div>}
      </Fragment>
    })}
  </div>
}

function dotOf(agent: Agent) {
  switch (agentState(agent)) {
    case 'running': return 'ok'
    case 'starting': return 'wait'
    case 'not_answering':
    case 'missing': return 'bad'
    case 'stopped': return 'off'
  }
}
