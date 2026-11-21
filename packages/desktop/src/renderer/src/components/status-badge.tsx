import type { ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { AlertCircleIcon, CheckmarkBadge01Icon, DashedLineCircleIcon, UnavailableIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Badge } from '@/components/ui/badge'

const BADGE_CHECK = badge(CheckmarkBadge01Icon)
const DASHED = badge(DashedLineCircleIcon)
const BAN = badge(UnavailableIcon)
const ALERT = badge(AlertCircleIcon)
const STATUS = {
  connected: { word: 'Connected', tip: 'Last call succeeded', variant: 'success', icon: BADGE_CHECK },
  failing: { word: 'Failing', tip: 'Last call failed', variant: 'outline', icon: ALERT },
  no_calls: { word: 'No calls yet', tip: 'No agent has called it yet', variant: 'outline', icon: DASHED },
  denied: { word: 'Denied', tip: 'No grant for this tool', variant: 'destructive', icon: BAN },
  failed: { word: 'Failed', tip: 'The tool ran and failed', variant: 'outline', icon: ALERT },
} satisfies Record<string, { word: string; tip: string; variant: 'success' | 'destructive' | 'outline'; icon: ReactNode }>

export function StatusBadge({ status, tip = STATUS[status].tip, word = STATUS[status].word }: { status: keyof typeof STATUS; tip?: string; word?: string }) {
  return <Badge variant={STATUS[status].variant} title={tip}>{STATUS[status].icon}{word}</Badge>
}

function badge(svg: IconSvgElement) {
  return <HugeiconsIcon icon={svg} strokeWidth={2} aria-hidden="true" />
}

export function agentState(agent: Agent) {
  if (!agent.runsHere && agent.wanted === 'running') return 'running'
  if (agent.status !== 'running' || agent.health === null || agent.health === 'answering') return agent.status
  return agent.health
}
