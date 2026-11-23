import * as z from 'zod/mini'

export const MEMORY_LIMITS = { notes: 2200, people: 1375 } as const
export const MEMORY_DELIMITER = '\n§\n'

export type MemoryTarget = keyof typeof MEMORY_LIMITS

const MemoryBlock = z.object({ entries: z.array(z.string()), used: z.number(), limit: z.number(), saved: z.boolean() })
export type MemoryBlock = z.infer<typeof MemoryBlock>

export const Memory = z.object({
  id: z.string(),
  object: z.literal('memory'),
  agentId: z.string(),
  notes: MemoryBlock,
  people: MemoryBlock,
})
export type Memory = z.infer<typeof Memory>

const Entries = z.array(z.string().check(z.minLength(1), z.maxLength(MEMORY_LIMITS.notes))).check(z.maxLength(200))

export const UpdateMemory = z.object({ notes: z.optional(Entries), people: z.optional(Entries) })
export type UpdateMemory = z.infer<typeof UpdateMemory>

export function memoryLength(entries: string[]): number {
  return [...entries.join(MEMORY_DELIMITER)].length
}

export const MemoryRecord = z.object({ notes: z.nullable(z.string()), people: z.nullable(z.string()) })
export type MemoryRecord = z.infer<typeof MemoryRecord>
