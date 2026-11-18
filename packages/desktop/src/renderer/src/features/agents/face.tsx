import type { Agent } from '@openhut/common/agents/agent.ts'
import { Creature } from '@/components/creature'
import { parseLook, randomLook, type Look } from '@/lib/face'

const KEY = 'openhut.face.'

type Faced = Pick<Agent, 'id' | 'instructions'> & { face?: string | null }

export function lookOf(agent: Faced): Look {
  return parsed(agent.face) ?? parsed(localFace(agent.id)) ?? randomLook({ seed: agent.id, about: agent.instructions })
}

export function localFace(agentId: string): string | null {
  try {
    const text = localStorage.getItem(KEY + agentId)
    return parsed(text) ? text : null
  } catch {
    return null
  }
}

function parsed(text: string | null | undefined): Look | null {
  try {
    return text ? parseLook(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export function Face({ agent, size, tile, className }: { agent: Faced; size: number; tile?: boolean; className?: string }) {
  return <Creature look={lookOf(agent)} size={size} tile={tile} className={className} />
}
