import { closeSync, constants, ftruncateSync, writeSync } from 'node:fs'
import { openInside, readInside } from './skills.ts'

const FILES = { notes: 'MEMORY.md', people: 'USER.md' } as const
export const MAX_MEMORY_BYTES = 64_000

export type MemoryTarget = keyof typeof FILES

export function isMemoryTarget(value: unknown): value is MemoryTarget {
  return value === 'notes' || value === 'people'
}

export function readMemory(root: string): Record<MemoryTarget, string | null> {
  return {
    notes: readInside({ root, file: FILES.notes, limit: MAX_MEMORY_BYTES }) ?? null,
    people: readInside({ root, file: FILES.people, limit: MAX_MEMORY_BYTES }) ?? null,
  }
}

export function writeMemory({ root, target, body }: { root: string; target: MemoryTarget; body: string }): void {
  const fd = openInside({ root, file: FILES[target], flags: constants.O_WRONLY })
  if (fd === undefined) throw new Error('the agent has not saved that memory yet')
  try {
    ftruncateSync(fd, 0)
    writeSync(fd, body, 0)
  } finally {
    closeSync(fd)
  }
}
