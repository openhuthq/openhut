import { db } from './db.ts'
import { seal, unseal } from './secrets.ts'

export const COLLECTIONS = ['agent', 'control', 'message', 'memory', 'skill', 'routine', 'channel'] as const
export type Collection = typeof COLLECTIONS[number]
export type Secret = Record<string, unknown>
export type Held<T = unknown, S = unknown> = {
  collection: Collection; id: string; workspace: string; parent?: string; ver: number; by: string
  value: T; secret?: S; personal?: boolean; deleted?: boolean
}
export type Change = { collection: Collection; id: string; ver: number; workspace: string; backup?: boolean }
export type Patch = { value: unknown; secret?: unknown }
type Fields = { workspace: string; value: unknown; secret?: unknown; personal?: boolean; queue?: boolean; reapply?: (current: Held) => Patch | null | Promise<Patch | null> }
export type PutRecord = Fields & ({ collection: 'control' | 'memory'; parent: string; id?: undefined } | { collection: Exclude<Collection, 'control' | 'memory'>; id: string; parent?: string })
type Row = { key: string; collection: string; id: string; workspace: string; parent: string | null; ver: number; value: string; secret: string | null; personal: boolean; deleted: boolean }

const listeners = new Set<(change: Change) => Promise<void> | void>()

export const recordsService = {
  async list({ collection, workspace, parent }: { collection: Collection; workspace: string; parent?: string }): Promise<Held[]> {
    let query = db.selectFrom('record').selectAll().where('collection', '=', collection).where('workspace', '=', workspace).where('deleted', '=', false)
    if (parent !== undefined) query = query.where('parent', '=', parent)
    return (await query.orderBy('ver').execute()).map(heldOf)
  },

  async get({ collection, workspace, id }: { collection: Collection; workspace: string; id: string }): Promise<Held | null> {
    const row = await db.selectFrom('record').selectAll().where('key', '=', keyOf({ collection, id })).executeTakeFirst()
    return row && row.collection === collection && row.workspace === workspace ? heldOf(row) : null
  },

  put: (input: PutRecord): Promise<Held> => write({ ...input, id: idOf(input), deleted: false, backup: input.queue }),

  async remove({ collection, workspace, id, queue }: { collection: Collection; workspace: string; id: string; queue?: boolean }): Promise<void> {
    const current = await recordsService.get({ collection, workspace, id })
    if (current && !current.deleted) await write({ ...current, value: null, secret: undefined, deleted: true, backup: queue })
  },

  async lease({ collection, workspace, id, refresh }: { collection: Collection; workspace: string; id: string; refresh: (secret: Secret) => Promise<Secret> }): Promise<Held> {
    const current = await recordsService.get({ collection, workspace, id })
    if (!current || current.deleted) throw new Error('That record doesn’t exist anymore. It may have been deleted.')
    return write({ ...current, secret: await refresh((current.secret ?? {}) as Secret), deleted: false })
  },

  held: async (id: string): Promise<number> => (await db.selectFrom('record').select('ver').where('key', '=', id).executeTakeFirst())?.ver ?? 0,

  onChange(listener: (change: Change) => Promise<void> | void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function keyOf({ collection, id }: { collection: string; id: string }): string {
  return collection === 'control' || collection === 'memory' ? `${collection}:${id}` : id
}

export function idOf(input: PutRecord): string {
  return input.id === undefined ? input.parent : input.id
}

async function write({ collection, id, workspace, parent, value, secret, personal, deleted, backup }: { collection: Collection; id: string; workspace: string; parent?: string; value: unknown; secret?: unknown; personal?: boolean; deleted: boolean; backup?: boolean }): Promise<Held> {
  const fields = { collection, id, workspace, parent: parent ?? null, value: JSON.stringify(value ?? null), secret: secret === undefined ? null : seal(JSON.stringify(secret)), personal: !!personal, deleted }
  const row = await db.insertInto('record').values({ key: keyOf({ collection, id }), ver: 1, ...fields })
    .onConflict((oc) => oc.column('key').doUpdateSet((eb) => ({ ...fields, ver: eb('record.ver', '+', 1) }))).returningAll().executeTakeFirstOrThrow()
  const held = heldOf(row)
  await changed({ collection, id, ver: held.ver, workspace, ...backup && { backup } })
  return held
}

export async function changed(change: Change): Promise<void> {
  await Promise.all([...listeners].map((listener) => listener(change)))
}

function heldOf(row: Row): Held {
  return {
    collection: row.collection as Collection, id: row.id, workspace: row.workspace, ...row.parent !== null && { parent: row.parent }, ver: row.ver, by: 'here',
    value: JSON.parse(row.value), ...row.secret !== null && { secret: JSON.parse(unseal(row.secret)) }, ...row.personal && { personal: true }, ...row.deleted && { deleted: true },
  }
}
