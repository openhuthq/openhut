import { Memory, MemoryRecord, MEMORY_DELIMITER, MEMORY_LIMITS, memoryLength, type MemoryBlock, type MemoryTarget, type UpdateMemory } from '@openhut/common/agents/memory.ts'
import { agent } from '../../core/agent.ts'
import { db } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { recordsService, type Held } from '../platform/records.ts'
import type { Caller } from '../team/identity.ts'
import { agentService, mayEdit, placeOf, type AgentFacts } from './agent-service.ts'

const TARGETS: MemoryTarget[] = ['notes', 'people']
const LABEL: Record<MemoryTarget, string> = { notes: 'Notes', people: 'What it knows about people' }
const FILE: Record<MemoryTarget, string> = { notes: 'MEMORY', people: 'USER' }
const BARE_DELIMITER = /(^|\n)§(\n|$)/
const sent = new Map<string, string>()

export const memoryService = {
  async get({ agentId }: { actor: Caller; agentId: string }): Promise<Memory> {
    return memoryOf({ agentId, raw: await rawOf(await agentService.find({ id: agentId })) })
  },

  async update({ actor, agentId, patch }: { actor: Caller; agentId: string; patch: UpdateMemory }): Promise<Memory> {
    const facts = await agentService.find({ id: agentId })
    if (!mayEdit({ facts, actor })) throw new HttpError(403, `Only ${facts.owner} or an admin can change ${facts.value.name}'s memory.`)
    const raw = await rawOf(facts)
    const current = memoryOf({ agentId, raw })
    const next: MemoryRecord = { ...raw }
    for (const target of TARGETS) {
      const entries = patch[target]?.map((entry) => entry.trim())
      if (!entries) continue
      if (!current[target].saved) throw new HttpError(409, `The agent hasn't saved anything to ${LABEL[target].toLowerCase()} yet. It can be edited here once it has.`)
      if (entries.some((entry) => !entry || BARE_DELIMITER.test(entry))) throw new HttpError(400, 'Each entry needs some text. Type something, or remove it.', { param: target })
      const over = memoryLength(entries) - MEMORY_LIMITS[target]
      if (over > 0) throw new HttpError(400, `${LABEL[target]} are ${over.toLocaleString('en')} characters over the ${MEMORY_LIMITS[target].toLocaleString('en')} limit. Shorten or remove an entry.`, { param: target })
      next[target] = entries.join(MEMORY_DELIMITER)
      emit({ name: 'memory.updated', actor, target: { type: 'memory', id: agentId, file: target, entries: entries.length } })
    }
    const changed = (value: MemoryRecord): MemoryRecord => ({ ...value, ...Object.fromEntries(TARGETS.filter((target) => patch[target]).map((target) => [target, next[target]])) })
    await recordsService.put({ collection: 'memory', parent: agentId, workspace: facts.workspace, personal: facts.personal, value: next, reapply: (latest) => ({ value: changed(MemoryRecord.safeParse(latest.value).data ?? raw) }) })
    if (facts.row) await memoryService.applyRecord({ agentId, record: { value: next } })
    return memoryOf({ agentId, raw: next })
  },

  async backUp({ agentId }: { agentId: string }): Promise<void> {
    const row = await db.selectFrom('agent').select(['workspace', 'shared']).where('id', '=', agentId).executeTakeFirst()
    if (!row) return
    const value = await disk(agentId)
    const text = JSON.stringify(value)
    if ((value.notes === null && value.people === null) || sent.get(agentId) === text) return
    await recordsService.put({ collection: 'memory', parent: agentId, ...placeOf(row), value, queue: true, reapply: () => null })
    sent.set(agentId, text)
  },

  async applyRecord({ agentId, record }: { agentId: string; record: Pick<Held, 'value'> | null }): Promise<void> {
    const value = MemoryRecord.safeParse(record?.value).data
    if (!value) return
    const now = await disk(agentId)
    for (const target of TARGETS) {
      const text = value[target]
      if (text !== null && text !== now[target]) await agent.content.write({ id: agentId, ref: { kind: 'memory', name: FILE[target] }, body: text, by: 'person', create: true })
    }
    sent.set(agentId, JSON.stringify({ ...now, ...Object.fromEntries(TARGETS.filter((target) => value[target] !== null).map((target) => [target, value[target]])) }))
  },
}

async function rawOf(facts: AgentFacts): Promise<MemoryRecord> {
  if (facts.row) return disk(facts.id)
  const held = await recordsService.get({ collection: 'memory', workspace: facts.workspace, id: facts.id })
  return MemoryRecord.safeParse(held?.value).data ?? { notes: null, people: null }
}

async function disk(agentId: string): Promise<MemoryRecord> {
  const [notes, people] = await Promise.all(TARGETS.map((target) => agent.content.read(agentId, { kind: 'memory', name: FILE[target] })))
  return { notes: notes?.toString('utf8') ?? null, people: people?.toString('utf8') ?? null }
}

function memoryOf({ agentId, raw }: { agentId: string; raw: MemoryRecord }): Memory {
  return { id: agentId, object: 'memory', agentId, notes: blockOf({ target: 'notes', raw: raw.notes }), people: blockOf({ target: 'people', raw: raw.people }) }
}

function blockOf({ target, raw }: { target: MemoryTarget; raw: string | null }): MemoryBlock {
  const entries = (raw ?? '').split(MEMORY_DELIMITER).map((entry) => entry.trim()).filter(Boolean)
  return { entries, used: memoryLength(entries), limit: MEMORY_LIMITS[target], saved: raw !== null }
}
