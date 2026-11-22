import type { MemoryValue } from '@openhut/common/cloud/record.ts'
import { Memory, MEMORY_DELIMITER, MEMORY_LIMITS, memoryLength, type MemoryBlock, type MemoryTarget, type UpdateMemory } from '@openhut/common/agents/memory.ts'
import { agentd } from '../platform/agentd.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import type { Caller } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

const TARGETS: MemoryTarget[] = ['notes', 'people']
const LABEL: Record<MemoryTarget, string> = { notes: 'Notes', people: 'What it knows about people' }
const FILE: Record<MemoryTarget, string> = { notes: 'memories/MEMORY.md', people: 'memories/USER.md' }
const BARE_DELIMITER = /(^|\n)§(\n|$)/

export const memoryService = {
  async get({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Memory> {
    await agentService.get({ actor, id: agentId })
    const [notes, people] = await Promise.all(TARGETS.map((target) => agentd.read({ id: agentId, path: FILE[target] })))
    return { id: agentId, object: 'memory', agentId, notes: blockOf({ target: 'notes', raw: notes?.toString('utf8') ?? null }), people: blockOf({ target: 'people', raw: people?.toString('utf8') ?? null }) }
  },

  async update({ actor, agentId, patch }: { actor: Caller; agentId: string; patch: UpdateMemory }): Promise<Memory> {
    await agentService.requireEditable({ actor, id: agentId })
    if (!(await agentService.get({ actor, id: agentId })).runsHere) throw new HttpError(409, 'This agent runs on your other computer, so its memory changes there.')
    const current = await memoryService.get({ actor, agentId })
    for (const target of TARGETS) {
      const entries = patch[target]?.map((entry) => entry.trim())
      if (!entries) continue
      if (!current[target].saved) throw new HttpError(409, `The agent hasn't saved anything to ${LABEL[target].toLowerCase()} yet. It can be edited here once it has.`)
      if (entries.some((entry) => !entry || BARE_DELIMITER.test(entry))) throw new HttpError(400, 'Each entry needs some text. Type something, or remove it.', { param: target })
      const over = memoryLength(entries) - MEMORY_LIMITS[target]
      if (over > 0) throw new HttpError(400, `${LABEL[target]} are ${over.toLocaleString('en')} characters over the ${MEMORY_LIMITS[target].toLocaleString('en')} limit. Shorten or remove an entry.`, { param: target })
      await agentd.write({ id: agentId, path: FILE[target], body: entries.join(MEMORY_DELIMITER) })
      emit({ name: 'memory.updated', actor, target: { type: 'memory', id: agentId, file: target, entries: entries.length } })
    }
    return memoryService.get({ actor, agentId })
  },

  async synced({ agentIds }: { agentIds: string[] }): Promise<MemoryValue[]> {
    const values: MemoryValue[] = []
    for (const id of agentIds) {
      const notes = await agentd.read({ id, path: FILE.notes })
      const people = await agentd.read({ id, path: FILE.people })
      if (notes?.length || people?.length) values.push({ agentId: id, notes: notes?.toString('utf8') ?? null, people: people?.toString('utf8') ?? null })
    }
    return values
  },

  async applySynced(value: MemoryValue): Promise<void> {
    for (const target of TARGETS) {
      const text = value[target]
      if (text !== null) await agentd.write({ id: value.agentId, path: FILE[target], body: text, create: true })
    }
    emit({ name: 'memory.synced', target: { type: 'memory', id: value.agentId } })
  },
}

function blockOf({ target, raw }: { target: MemoryTarget; raw: string | null }): MemoryBlock {
  const entries = (raw ?? '').split(MEMORY_DELIMITER).map((entry) => entry.trim()).filter(Boolean)
  return { entries, used: memoryLength(entries), limit: MEMORY_LIMITS[target], saved: raw !== null }
}
