import type { Agent } from '@openhut/common/agents/agent.ts'
import { Status, type Tone } from '@/components/kit'
import { agentState } from '@/components/status-badge'

const STATES: Record<ReturnType<typeof agentState>, [Tone, string]> = {
  running: ['on', 'Running'],
  starting: ['wait', 'Starting'],
  stopped: ['off', 'Asleep'],
  not_answering: ['bad', 'Not answering'],
  no_seat: ['bad', 'Not ready'],
  missing: ['bad', 'Error'],
}

export function toneOf(agent: Agent): Tone {
  return STATES[agentState(agent)][0]
}

export function AgentStatus({ agent }: { agent: Agent }) {
  const [tone, word] = STATES[agentState(agent)]
  return <span title={agent.healthDetail || undefined}><Status tone={tone}>{word}</Status></span>
}
