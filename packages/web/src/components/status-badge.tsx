import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { AlertCircleIcon, CancelCircleIcon, CheckmarkBadge01Icon, CheckmarkCircle02Icon, CircleIcon, DashedLineCircleIcon, Loading02Icon, PauseCircleIcon, UnavailableIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { RunStatus } from '@openhut/common/automations/automation.ts'

const CHECK_CIRCLE = badge(CheckmarkCircle02Icon)
const BADGE_CHECK = badge(CheckmarkBadge01Icon)
const DASHED = badge(DashedLineCircleIcon)
const BAN = badge(UnavailableIcon)
const ALERT = badge(AlertCircleIcon)
const PAUSE = badge(PauseCircleIcon)
const STATUS = {
  running: { word: 'Ready', tip: 'Running and answering', variant: 'success', icon: CHECK_CIRCLE },
  starting: { word: 'Starting', tip: 'Hermes is starting', variant: 'warning', icon: DASHED },
  no_seat: { word: 'Not ready', tip: 'No Claude seat is connected', variant: 'warning', icon: ALERT },
  not_answering: { word: 'Not answering', tip: 'Running, but Hermes isn\'t answering', variant: 'destructive', icon: ALERT },
  stopped: { word: 'Stopped', tip: 'Container stopped', variant: 'secondary', icon: PAUSE },
  missing: { word: 'Error', tip: 'Its container is gone. It is recreated within 30 seconds while it should be running.', variant: 'destructive', icon: ALERT },
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

function badge(svg: IconSvgElement) {
  return <HugeiconsIcon icon={svg} strokeWidth={2} aria-hidden="true" />
}

export function AgentBadge({ agent }: { agent: Agent }) {
  const status = agentState(agent)
  return <StatusBadge status={status} tip={agent.healthDetail || STATUS[status].tip} />
}

export function agentState(agent: Agent) {
  if (agent.status !== 'running' || agent.health === null || agent.health === 'answering') return agent.status
  return agent.health
}

const RUN = {
  running: { icon: Loading02Icon, word: 'Running' },
  done: { icon: CheckmarkCircle02Icon, word: 'Done' },
  quiet: { icon: CircleIcon, word: 'Nothing new' },
  skipped: { icon: DashedLineCircleIcon, word: 'Skipped' },
  failed: { icon: CancelCircleIcon, word: 'Failed' },
}

export function RunIcon({ status, size = 16 }: { status: RunStatus | 'paused'; size?: number }) {
  const { icon, word } = status === 'paused' ? { icon: DashedLineCircleIcon, word: 'Paused' } : RUN[status]
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={`runicon ${status}`} aria-label={word} role="img" />
}
