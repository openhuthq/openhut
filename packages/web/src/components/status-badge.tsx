import type { ReactNode } from 'react'
import type { Agent } from '@fastmonkey/common/agents/agent.ts'

const CHECK_CIRCLE = badge(<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>)
const BADGE_CHECK = badge(<><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="m9 12 2 2 4-4" /></>)
const DASHED = badge(<circle cx="12" cy="12" r="10" strokeDasharray="4 3.5" />)
const BAN = badge(<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>)
const ALERT = badge(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>)
const PAUSE = badge(<><circle cx="12" cy="12" r="10" /><line x1="10" x2="10" y1="15" y2="9" /><line x1="14" x2="14" y1="15" y2="9" /></>)
const STATUS = {
  running: { word: 'Ready', tip: 'Running and answering', variant: 'success', icon: CHECK_CIRCLE },
  starting: { word: 'Starting', tip: 'Hermes is starting', variant: 'warning', icon: DASHED },
  no_seat: { word: 'Not ready', tip: 'No Claude seat is connected', variant: 'warning', icon: ALERT },
  not_answering: { word: 'Not answering', tip: 'Running, but Hermes isn\'t answering', variant: 'destructive', icon: ALERT },
  stopped: { word: 'Stopped', tip: 'Container stopped', variant: 'secondary', icon: PAUSE },
  missing: { word: 'Error', tip: 'Its container is gone. Fast Monkey recreates it within 30 seconds while it should be running.', variant: 'destructive', icon: ALERT },
  connected: { word: 'Connected', tip: 'Last call succeeded', variant: 'success', icon: BADGE_CHECK },
  failing: { word: 'Failing', tip: 'Last call failed', variant: 'outline', icon: ALERT },
  no_calls: { word: 'No calls yet', tip: 'No agent has called it yet', variant: 'outline', icon: DASHED },
  ready: { word: 'Ready', tip: 'Done', variant: 'success', icon: BADGE_CHECK },
  not_set_up: { word: 'Not set up', tip: 'Not done', variant: 'outline', icon: DASHED },
  denied: { word: 'Denied', tip: 'No grant for this tool', variant: 'destructive', icon: BAN },
  failed: { word: 'Failed', tip: 'The tool ran and failed', variant: 'outline', icon: ALERT },
}

export function StatusBadge({ status, tip = STATUS[status].tip, word = STATUS[status].word }: { status: keyof typeof STATUS; tip?: string; word?: string }) {
  return <span className={`status ${STATUS[status].variant}`} data-slot="badge" title={tip}>{STATUS[status].icon}{word}</span>
}

function badge(body: ReactNode) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>
}

export function AgentBadge({ agent }: { agent: Agent }) {
  const status = agentState(agent)
  return <StatusBadge status={status} tip={agent.healthDetail || STATUS[status].tip} />
}

export function agentState(agent: Agent) {
  if (agent.status !== 'running' || agent.health === null || agent.health === 'answering') return agent.status
  return agent.health
}
