import { createHash } from 'node:crypto'
import { SkillRecord, type Skill, type UpdateSkill } from '@openhut/common/agents/skill.ts'
import { agentd } from '../platform/agentd.ts'
import { db } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { recordsService, type Held } from '../platform/records.ts'
import type { Caller } from '../team/identity.ts'
import { agentService, mayEdit, placeOf, type AgentFacts } from './agent-service.ts'

const SEPARATOR = '~'
const SKILL_ID = /^(ag_[a-z0-9]{8})~([A-Za-z0-9][\w.-]{0,63}(?:~[A-Za-z0-9][\w.-]{0,63}){0,2})$/
const sent = new Map<string, string>()

export const skillService = {
  async list({ agentId }: { actor: Caller; agentId: string }): Promise<Skill[]> {
    const facts = await agentService.find({ id: agentId })
    if (!facts.row) return (await records(facts)).map(({ path, body }) => skillOf({ agentId, path, head: body, builtIn: new Set(), body: null })).sort((a, b) => a.name.localeCompare(b.name))
    const { skills, bundled } = await agentd.skills({ id: agentId })
    const builtIn = new Set(bundled.split('\n').map((line) => line.split(':')[0]).filter(Boolean))
    return skills.map(({ path, head }) => skillOf({ agentId, path, head, builtIn, body: null }))
      .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Skill> {
    const { agentId, path } = partsOf(id)
    const found = (await skillService.list({ actor, agentId })).find((skill) => skill.id === id)
    if (!found) throw new HttpError(404, MISSING)
    const facts = await agentService.find({ id: agentId })
    const body = facts.row ? (await agentd.read({ id: agentId, path: skillFile(path) }))?.toString('utf8') : (await records(facts)).find((each) => each.path === path)?.body
    if (body === undefined) throw new HttpError(404, MISSING)
    return { ...found, body }
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateSkill }): Promise<Skill> {
    const { agentId, path } = partsOf(id)
    const facts = await editable({ actor, agentId })
    await recordsService.put({ collection: 'skill', id: recordIdOf({ agentId, path }), parent: agentId, workspace: facts.workspace, personal: facts.personal, value: { path, body: patch.body } })
    if (facts.row) await writeSkill({ agentId, path, body: patch.body })
    emit({ name: 'skill.updated', actor, target: { type: 'skill', id, agentId } })
    return skillService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<{ id: string; object: 'skill'; deleted: true }> {
    const skill = await skillService.get({ actor, id })
    const facts = await editable({ actor, agentId: skill.agentId })
    if (skill.builtIn) throw new HttpError(400, 'Built-in skills come with OpenHut and can\'t be deleted. Only skills the agent learned can.')
    await recordsService.remove({ collection: 'skill', workspace: facts.workspace, id: recordIdOf({ agentId: skill.agentId, path: skill.path }) })
    if (facts.row) await agentd.delete({ id: skill.agentId, paths: [`skills/${skill.path}`] })
    emit({ name: 'skill.deleted', actor, target: { type: 'skill', id, agentId: skill.agentId } })
    return { id, object: 'skill', deleted: true }
  },

  async backUp({ agentId }: { agentId: string }): Promise<void> {
    const row = await db.selectFrom('agent').select(['workspace', 'shared']).where('id', '=', agentId).executeTakeFirst()
    if (!row) return
    for (const path of await learned(agentId)) {
      const body = (await agentd.read({ id: agentId, path: skillFile(path) }))?.toString('utf8')
      const id = recordIdOf({ agentId, path })
      if (body === undefined || sent.get(id) === body) continue
      await recordsService.put({ collection: 'skill', id, parent: agentId, ...placeOf(row), value: { path, body }, queue: true, reapply: () => null })
      sent.set(id, body)
    }
  },

  async applyRecords({ agentId, records: held }: { agentId: string; records: Held[] }): Promise<void> {
    const wanted = new Map(held.flatMap((each) => {
      const value = SkillRecord.safeParse(each.value).data
      return value && SKILL_ID.test(`${agentId}${SEPARATOR}${value.path.replaceAll('/', SEPARATOR)}`) ? [[value.path, value.body] as const] : []
    }))
    for (const [path, body] of wanted) {
      if ((await agentd.read({ id: agentId, path: skillFile(path) }))?.toString('utf8') !== body) await writeSkill({ agentId, path, body })
      sent.set(recordIdOf({ agentId, path }), body)
    }
    for (const path of await learned(agentId)) {
      if (!wanted.has(path) && await recordsService.held(recordIdOf({ agentId, path })) > 0) await agentd.delete({ id: agentId, paths: [`skills/${path}`] })
    }
  },
}

const MISSING = 'That skill doesn\'t exist. The agent may have removed it.'

export function recordIdOf({ agentId, path }: { agentId: string; path: string }): string {
  return `sk_${createHash('sha256').update(`${agentId}/${path}`).digest('base64url').slice(0, 32)}`
}

async function editable({ actor, agentId }: { actor: Caller; agentId: string }): Promise<AgentFacts> {
  const facts = await agentService.find({ id: agentId })
  if (!mayEdit({ facts, actor })) throw new HttpError(403, `Only ${facts.owner} can change ${facts.value.name}'s skills.`)
  return facts
}

async function records(facts: AgentFacts): Promise<SkillRecord[]> {
  const held = await recordsService.list({ collection: 'skill', workspace: facts.workspace, parent: facts.id })
  return held.flatMap((each) => SkillRecord.safeParse(each.value).data ?? [])
}

async function learned(agentId: string): Promise<string[]> {
  const { skills, bundled } = await agentd.skills({ id: agentId })
  const builtIn = new Set(bundled.split('\n').map((line) => line.split(':')[0]).filter(Boolean))
  return skills.map(({ path, head }) => skillOf({ agentId, path, head, builtIn, body: null })).filter((skill) => !skill.builtIn).map((skill) => skill.path)
}

async function writeSkill({ agentId, path, body }: { agentId: string; path: string; body: string }): Promise<void> {
  await agentd.write({ id: agentId, path: skillFile(path), body, create: true })
}

function skillFile(path: string): string {
  return `skills/${path}/SKILL.md`
}

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
