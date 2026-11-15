import { Memory, MEMORY_DELIMITER, MEMORY_LIMITS, memoryLength, type MemoryBlock, type MemoryTarget, type UpdateMemory } from '@openhut/common/agents/memory.ts'
import { agentd } from '../platform/agentd.ts'
import { record } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import type { Caller } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

const TARGETS: MemoryTarget[] = ['notes', 'people']
const LABEL: Record<MemoryTarget, string> = { notes: 'Notes', people: 'What it knows about people' }
const BARE_DELIMITER = /(^|\n)§(\n|$)/

export const memoryService = {
  async get({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Memory> {
    await agentService.get({ actor, id: agentId })
    const files = await agentd.memory({ id: agentId })
    return { id: agentId, object: 'memory', agentId, notes: blockOf({ target: 'notes', raw: files.notes }), people: blockOf({ target: 'people', raw: files.people }) }
  },

  async update({ actor, agentId, patch }: { actor: Caller; agentId: string; patch: UpdateMemory }): Promise<Memory> {
    await agentService.requireEditable({ actor, id: agentId })
    const current = await memoryService.get({ actor, agentId })
    for (const target of TARGETS) {
      const entries = patch[target]?.map((entry) => entry.trim())
      if (!entries) continue
      if (!current[target].saved) throw new HttpError(409, `The agent hasn't saved anything to ${LABEL[target].toLowerCase()} yet. It can be edited here once it has.`)
      if (entries.some((entry) => !entry || BARE_DELIMITER.test(entry))) throw new HttpError(400, 'Each entry needs some text, and a line with only § in it can\'t be saved.', { param: target })
      const over = memoryLength(entries) - MEMORY_LIMITS[target]
      if (over > 0) throw new HttpError(400, `${LABEL[target]} are ${over.toLocaleString('en')} characters over the ${MEMORY_LIMITS[target].toLocaleString('en')} limit. Shorten or remove an entry.`, { param: target })
      await agentd.writeMemory({ id: agentId, target, body: entries.join(MEMORY_DELIMITER) })
      record({ action: 'memory.updated', actor, target: { type: 'memory', id: agentId, file: target, entries: entries.length } })
    }
    return memoryService.get({ actor, agentId })
  },
}

function blockOf({ target, raw }: { target: MemoryTarget; raw: string | null }): MemoryBlock {
  const entries = (raw ?? '').split(MEMORY_DELIMITER).map((entry) => entry.trim()).filter(Boolean)
  return { entries, used: memoryLength(entries), limit: MEMORY_LIMITS[target], saved: raw !== null }
}
