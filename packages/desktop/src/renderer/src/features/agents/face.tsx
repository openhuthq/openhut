import type { Agent } from '@openhut/common/agents/agent.ts'
import { Creature, avatarPng } from '@/components/creature'
import { parseLook, randomLook, type Look } from '@/lib/face'
import { squarePicture } from '@/lib/picture'
import { cn } from '@/lib/utils'

const KEY = 'openhut.face.'

type Faced = Pick<Agent, 'id' | 'instructions'> & { face?: string | null }

export function lookOf(agent: Faced): Look {
  return parsed(agent.face) ?? parsed(localFace(agent.id)) ?? randomLook({ seed: agent.id, about: agent.instructions })
}

export function photoOf(face: string | null | undefined): string | null {
  return face?.startsWith('data:image/') ? face : null
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
    return text && !photoOf(text) ? parseLook(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export async function slackIcon(agent: Faced): Promise<string> {
  const photo = photoOf(agent.face)
  if (!photo) return avatarPng(lookOf(agent))
  return (await squarePicture({ source: photo, size: 512, type: 'image/png' })).split(',')[1]
}

export function Face({ agent, size, tile, label, className }: { agent: Faced; size: number; tile?: boolean; label?: string; className?: string }) {
  const photo = photoOf(agent.face)
  if (photo) return <img src={photo} width={size} height={size} alt={label ?? ''} className={cn('block shrink-0 rounded-[24%] object-cover', className)} />
  return <Creature look={lookOf(agent)} size={size} tile={tile} label={label} className={className} />
}
