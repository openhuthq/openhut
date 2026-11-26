import type { ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { AlertCircleIcon, CheckmarkBadge01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Badge } from '@/components/ui/badge'

const BADGE_CHECK = badge(CheckmarkBadge01Icon)
const ALERT = badge(AlertCircleIcon)
const STATUS = {
  connected: { word: 'Connected', tip: 'Agents can use it', variant: 'success', icon: BADGE_CHECK },
  signed_out: { word: 'Signed out', tip: 'Its sign-in expired. Reconnect to keep using it.', variant: 'outline', icon: ALERT },
  rejected: { word: 'Login rejected', tip: 'It turned down the login. Reconnect to fix it.', variant: 'outline', icon: ALERT },
  failing: { word: 'Not working', tip: 'Its last few calls failed', variant: 'outline', icon: ALERT },
} satisfies Record<string, { word: string; tip: string; variant: 'success' | 'destructive' | 'outline'; icon: ReactNode }>

export function StatusBadge({ status, tip = STATUS[status].tip, word = STATUS[status].word }: { status: keyof typeof STATUS; tip?: string; word?: string }) {
  return <Badge variant={STATUS[status].variant} title={tip}>{STATUS[status].icon}{word}</Badge>
}

function badge(svg: IconSvgElement) {
  return <HugeiconsIcon icon={svg} strokeWidth={2} aria-hidden="true" />
}

export function agentState(agent: Agent) {
  if (!agent.runsHere && !agent.runsNowhere && agent.wanted === 'running') {
    if (agent.health && agent.health !== 'answering') return agent.health
    return 'running'
  }
  if (agent.status !== 'running' || agent.health === null || agent.health === 'answering') return agent.status
  return agent.health
}
