import type { Skill, UpdateSkill } from '@openhut/common/agents/skill.ts'
import { agentd } from '../platform/agentd.ts'
import { record } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import type { Caller } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

const SEPARATOR = '~'
const SKILL_ID = /^(ag_[a-z0-9]{8})~([A-Za-z0-9][\w.-]{0,63}(?:~[A-Za-z0-9][\w.-]{0,63}){0,2})$/

export const skillService = {
  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Skill[]> {
    await agentService.get({ actor, id: agentId })
    const { skills, bundled } = await agentd.skills({ id: agentId })
    const builtIn = new Set(bundled.split('\n').map((line) => line.split(':')[0]).filter(Boolean))
    return skills.map(({ path, head }) => skillOf({ agentId, path, head, builtIn, body: null }))
      .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Skill> {
    const { agentId, path } = partsOf(id)
    const found = (await skillService.list({ actor, agentId })).find((skill) => skill.id === id)
    if (!found) throw new HttpError(404, MISSING)
    return { ...found, body: (await agentd.readSkill({ id: agentId, path })).body }
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateSkill }): Promise<Skill> {
    const { agentId, path } = partsOf(id)
    await agentService.requireEditable({ actor, id: agentId })
    await agentd.writeSkill({ id: agentId, path, body: patch.body })
    record({ action: 'skill.updated', actor, target: { type: 'skill', id, agentId } })
    return skillService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<{ id: string; object: 'skill'; deleted: true }> {
    const skill = await skillService.get({ actor, id })
    await agentService.requireEditable({ actor, id: skill.agentId })
    if (skill.builtIn) throw new HttpError(400, 'Built-in skills come with Hermes and can\'t be deleted. Only skills the agent learned can.')
    await agentd.removeSkill({ id: skill.agentId, path: skill.path })
    record({ action: 'skill.deleted', actor, target: { type: 'skill', id, agentId: skill.agentId } })
    return { id, object: 'skill', deleted: true }
  },
}

const MISSING = 'That skill doesn\'t exist. The agent may have removed it.'

function partsOf(id: string): { agentId: string; path: string } {
  const match = SKILL_ID.exec(id)
  if (!match) throw new HttpError(404, MISSING)
  return { agentId: match[1], path: match[2].replaceAll(SEPARATOR, '/') }
}

function skillOf({ agentId, path, head, builtIn, body }: { agentId: string; path: string; head: string; builtIn: Set<string>; body: string | null }): Skill {
  const folder = path.split('/').at(-1) ?? path
  const name = fieldOf({ head, field: 'name' }) || folder
  return {
    id: `${agentId}${SEPARATOR}${path.replaceAll('/', SEPARATOR)}`, object: 'skill', agentId, path, name,
    description: fieldOf({ head, field: 'description' }), builtIn: builtIn.has(name) || builtIn.has(folder), body,
  }
}

function fieldOf({ head, field }: { head: string; field: string }): string {
  if (!head.startsWith('---')) return ''
  const block = head.slice(3).split(/\r?\n---/)[0]
  const value = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm').exec(block)?.[1].trim() ?? ''
  return value.replace(/^(["'])(.*)\1$/, '$2').slice(0, 300)
}
