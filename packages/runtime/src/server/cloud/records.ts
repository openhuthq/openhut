import { HttpError } from '../platform/http-error.ts'

export const COLLECTIONS = ['agent', 'control', 'message', 'memory', 'connection', 'skill', 'routine', 'channel', 'file'] as const
export type Collection = (typeof COLLECTIONS)[number]

export type Held<T = unknown, S = unknown> = {
  collection: Collection; id: string; workspace: string; parent?: string; ver: number; by: string
  value: T; secret?: S; personal?: boolean; deleted?: boolean
}
export type Change = { collection: Collection; id: string; ver: number; workspace: string }
export type Patch = { value: unknown; secret?: unknown }
export type PutRecord = {
  collection: Collection; id: string; workspace: string; parent?: string; value: unknown; secret?: unknown; personal?: boolean; queue?: boolean
  reapply?: (current: Held) => Patch | null | Promise<Patch | null>
}

const listeners = new Set<(change: Change) => void>()

export const recordsService = {
  list: async (_input: { collection: Collection; workspace: string; parent?: string }): Promise<Held[]> => notWired(),
  get: async (_input: { collection: Collection; id: string }): Promise<Held | null> => notWired(),
  batchGet: async (_input: { collection: Collection; ids: string[] }): Promise<Held[]> => notWired(),
  put: async (_input: PutRecord): Promise<Held | null> => notWired(),
  remove: async (_input: { collection: Collection; id: string; queue?: boolean }): Promise<void> => notWired(),
  held: async (_id: string): Promise<number> => notWired(),

  onChange(listener: (change: Change) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function changed(change: Change): void {
  for (const listener of listeners) listener(change)
}

function notWired(): never {
  throw new HttpError(503, 'OpenHut Cloud records aren’t ready on this computer yet.')
}
