import type { Agent } from '@openhut/common/agents/agent.ts'
import { Creature } from '@/components/creature'

export type Look = { id: string; about: string }

const KEY = 'openhut.face.'

export function lookOf(agent: Pick<Agent, 'id' | 'instructions'>): Look {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY + agent.id) ?? 'null')
    if (saved && typeof saved === 'object' && 'id' in saved && 'about' in saved && typeof saved.id === 'string' && typeof saved.about === 'string') return { id: saved.id, about: saved.about }
  } catch {
    return { id: agent.id, about: agent.instructions }
  }
  return { id: agent.id, about: agent.instructions }
}

export function saveLook({ agentId, look }: { agentId: string; look: Look }) {
  try {
    localStorage.setItem(KEY + agentId, JSON.stringify(look))
  } catch {
    return
  }
}

export function Face({ agent, size, className }: { agent: Pick<Agent, 'id' | 'instructions'>; size: number; className?: string }) {
  const look = lookOf(agent)
  return <Creature id={look.id} about={look.about} size={size} className={className} />
}
