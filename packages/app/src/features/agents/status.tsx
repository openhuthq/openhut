import type { Agent } from '@openhut/common/agents/agent.ts'
import { Status, type Tone } from '@/components/kit'
import { agentState } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { useRestarting, useRetryApply } from '@/features/agents/api'
import { toastError } from '@/lib/toast'

const STATES: Record<ReturnType<typeof agentState>, [Tone, string]> = {
  running: ['on', 'Running'],
  starting: ['wait', 'Starting'],
  stopped: ['off', 'Stopped'],
  not_answering: ['bad', 'Not answering'],
  no_seat: ['bad', 'Model not connected'],
  setup_failed: ['bad', 'Couldn’t start'],
  missing: ['bad', 'Stopped unexpectedly'],
}

export function toneOf(agent: Agent): Tone {
  return STATES[agentState(agent)][0]
}

export function wordOf(agent: Agent): string {
  return STATES[agentState(agent)][1]
}

export function troubleOf(agent: Agent): string | undefined {
  const [tone, word] = STATES[agentState(agent)]
  return tone === 'bad' ? word : undefined
}

export function AgentStatus({ agent }: { agent: Agent }) {
  const restarting = useRestarting(agent.id)
  if (restarting) return <Status tone="wait">Restarting…</Status>
  if (agent.applyError) return <RetryApply agent={agent} />
  if (agent.applying) return <Status tone="wait">Updating…</Status>
  const [tone, word] = STATES[agentState(agent)]
  return <span title={agent.healthDetail || undefined}><Status tone={tone}>{word}</Status></span>
}

function RetryApply({ agent }: { agent: Agent }) {
  const retry = useRetryApply(agent.id)
  return <span className="inline-flex items-center gap-2" title={agent.applyError ?? undefined}>
    <Status tone="bad">Couldn’t apply your last change</Status>
    <Button type="button" variant="ghost" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(undefined, { onError: toastError })}>Retry</Button>
  </span>
}
