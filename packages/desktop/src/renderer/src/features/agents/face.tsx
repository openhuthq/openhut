import type { Agent } from '@openhut/common/agents/agent.ts'
import { Creature } from '@/components/creature'
import { parseLook, randomLook, type Look } from '@/lib/face'

const KEY = 'openhut.face.'

export function lookOf(agent: Pick<Agent, 'id' | 'instructions'>): Look {
  try {
    const saved = parseLook(JSON.parse(localStorage.getItem(KEY + agent.id) ?? 'null'))
    if (saved) return saved
  } catch {
    return randomLook({ seed: agent.id, about: agent.instructions })
  }
  return randomLook({ seed: agent.id, about: agent.instructions })
}

export function saveLook({ agentId, look }: { agentId: string; look: Look }) {
  try {
    localStorage.setItem(KEY + agentId, JSON.stringify(look))
  } catch {
    return
  }
}

export function Face({ agent, size, tile, className }: { agent: Pick<Agent, 'id' | 'instructions'>; size: number; tile?: boolean; className?: string }) {
  return <Creature look={lookOf(agent)} size={size} tile={tile} className={className} />
}
