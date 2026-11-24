import { sql } from 'kysely'
import * as z from 'zod/mini'
import type { MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { viewersOf } from '@openhut/common/cloud/member-list.ts'
import type { Roster } from '@openhut/common/records/allowed.ts'
import { RecordsError, type RecordsClient } from '@openhut/common/cloud/records.ts'
import { refreshWithLease, type Secret } from '@openhut/common/records/lease.ts'
import type { Opened, Value } from '@openhut/common/records/row.ts'
import { keyring } from '@openhut/common/keyring/keyring.ts'
import { COLLECTIONS, type Collection } from '@openhut/common/records/wire.ts'
import type { Bytes } from '@openhut/common/vault/public.ts'
import { cloud } from '../platform/cloud.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { seal, unseal } from '../platform/secrets.ts'
import { keysService } from './keys-service.ts'
import { roomKeys } from './room-keys.ts'

export { COLLECTIONS, type Collection }
export type Held<T = unknown, S = unknown> = {
  collection: Collection; id: string; workspace: string; parent?: string; ver: number; by: string
  value: T; secret?: S; personal?: boolean; deleted?: boolean
}
export type Change = { collection: Collection; id: string; ver: number; workspace: string }
export type Patch = { value: unknown; secret?: unknown }
type Fields = { workspace: string; value: unknown; secret?: unknown; personal?: boolean; queue?: boolean; reapply?: (current: Held) => Patch | null | Promise<Patch | null> }
export type PutRecord = Fields & ({ collection: 'control' | 'memory'; parent: string; id?: undefined } | { collection: Exclude<Collection, 'control' | 'memory'>; id: string; parent?: string })
type Write = Fields & { collection: Collection; id: string; parent?: string; deleted?: boolean }
type Seen = { ver: number; parent: string | null }

const Queued = z.object({ value: z.unknown(), secret: z.optional(z.unknown()), personal: z.optional(z.boolean()) })
const listeners = new Set<(change: Change) => void>()
let seen: Promise<Map<string, Seen>> | undefined
let draining: Promise<void> = Promise.resolve()

let refused: (workspace: string) => void = () => undefined

export const recordsService = {
  async list({ collection, workspace, parent }: { collection: Collection; workspace: string; parent?: string }): Promise<Held[]> {
    const records = await clientNow()
    const all: Held[] = []
    for (let startingAfter: string | undefined, more = true; more;) {
      const page = await reach(() => records.list({ collection, workspace, parent, startingAfter }), workspace)
      for (const row of page.data) all.push(await keep(row))
      startingAfter = page.next ?? undefined
      more = page.next !== null
    }
    return all.filter((each) => !each.deleted)
  },

  async get({ collection, workspace, id }: { collection: Collection; workspace: string; id: string }): Promise<Held | null> {
    const records = await clientNow()
    const row = await reach(() => records.get({ collection, workspace, id }), workspace)
    return row && keep(row)
  },

  put: (input: PutRecord): Promise<Held | null> => send({ ...input, id: idOf(input) }),

  async remove({ collection, workspace, id, queue }: { collection: Collection; workspace: string; id: string; queue?: boolean }): Promise<void> {
    const held = (await seenMap()).get(keyOf({ collection, id })) ?? await recordsService.get({ collection, workspace, id }).then((row) => row && { parent: row.parent ?? null })
    if (held) await send({ collection, workspace, id, parent: held.parent ?? undefined, value: null, queue, deleted: true })
  },

  async lease({ collection, workspace, id, refresh }: { collection: Collection; workspace: string; id: string; refresh: (secret: Secret) => Promise<Secret> }): Promise<Held> {
    const records = await clientNow()
    const row = await reach(() => records.get({ collection, workspace, id }))
    if (!row || row.deleted) throw new HttpError(404, 'That record doesn’t exist anymore. It may have been deleted.')
    await keep(row)
    return keep(await reach(() => refreshWithLease({ records, row, refresh })))
  },

  held: async (id: string): Promise<number> => (await seenMap()).get(id)?.ver ?? 0,

  onRefused(listener: (workspace: string) => void): void {
    refused = listener
  },

  onChange(listener: (change: Change) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  drain(): Promise<void> {
    draining = draining.then(drainOnce).catch((err: unknown) => log.warn({ event: 'records.drain_failed', error: messageOf(err) }))
    return draining
  },

  async sent(): Promise<boolean> {
    await recordsService.drain()
    return !await db.selectFrom('record_outbox').select('seq').executeTakeFirst()
  },
}

export function keyOf({ collection, id }: { collection: string; id: string }): string {
  return collection === 'control' || collection === 'memory' ? `${collection}:${id}` : id
}

export function idOf(input: PutRecord): string {
  return input.id === undefined ? input.parent : input.id
}

export function changed(change: Change): void {
  for (const listener of listeners) listener(change)
}

async function send(input: Write): Promise<Held | null> {
  const waiting = await db.selectFrom('record_outbox').select('seq').where('id', '=', keyOf(input)).executeTakeFirst()
  if (input.queue && waiting) return queue(input).then(() => null)
  try {
    const saved = await write(input)
    if (waiting) await db.deleteFrom('record_outbox').where('id', '=', keyOf(input)).execute()
    return saved
  } catch (error) {
    if (input.queue && unreachable(error)) return queue(input).then(() => null)
    throw httpOf(error)
  }
}

async function write({ collection, id, workspace, parent, value, secret, personal, reapply, deleted }: Write): Promise<Held> {
  const records = await clientNow()
  const where = { collection, workspace, parent: parent ?? null, id, current: (await seenMap()).get(keyOf({ collection, id }))?.ver ?? 0 }
  let gaveUp = false
  try {
    const saved = deleted
      ? await records.remove(where)
      : await records.put({ ...where, value: valueOf({ value, secret, personal }), reapply: reapply && (async (latest) => {
        const next = await reapply(await keep(latest))
        gaveUp = !next
        return next && valueOf({ ...next, personal })
      }) })
    return await keep(saved)
  } catch (error) {
    if (!(error instanceof RecordsError) || error.status !== 409 || !error.current) throw error
    const current = await keep(error.current)
    if (gaveUp) return current
    throw new HttpError(409, 'Someone changed this a moment ago. Try again.')
  }
}

async function queue({ collection, id, workspace, parent, value, secret, personal, deleted = false }: Write): Promise<void> {
  const body = seal(JSON.stringify({ value, secret, personal }))
  await db.insertInto('record_outbox').values({ id: keyOf({ collection, id }), collection, workspace, parent: parent ?? null, body, deleted })
    .onConflict((oc) => oc.column('id').doUpdateSet({ body, deleted, parent: parent ?? null })).execute()
  log.warn({ event: 'records.queued', collection, id })
}

async function drainOnce(): Promise<void> {
  for (const row of await db.selectFrom('record_outbox').selectAll().orderBy('seq').execute()) {
    const queued = z.parse(Queued, JSON.parse(unseal(row.body)))
    const input = { ...queued, collection: z.parse(z.enum(COLLECTIONS), row.collection), id: row.id === keyOf({ collection: row.collection, id: row.parent ?? '' }) ? row.parent ?? row.id : row.id, workspace: row.workspace, parent: row.parent ?? undefined, deleted: row.deleted }
    try {
      await write({ ...input, reapply: (current) => current.deleted ? null : queued })
    } catch (error) {
      if (unreachable(error)) return
      log.warn({ event: 'records.refused', collection: row.collection, id: row.id, error: messageOf(error) })
    }
    await db.deleteFrom('record_outbox').where('seq', '=', row.seq).execute()
  }
}

async function keep(row: Opened): Promise<Held> {
  const map = await seenMap()
  const key = keyOf({ collection: row.object, id: row.id })
  if ((map.get(key)?.ver ?? 0) < row.ver) {
    map.set(key, { ver: row.ver, parent: row.parent })
    await db.insertInto('record_held').values({ id: key, ver: row.ver, parent: row.parent })
      .onConflict((oc) => oc.column('id').doUpdateSet({ ver: sql<number>`greatest(record_held.ver, excluded.ver)`, parent: row.parent })).execute()
  }
  const { workspace, own, vault } = row.value
  return {
    collection: row.object, id: row.id, workspace: row.workspace, ...row.parent !== null && { parent: row.parent }, ver: row.ver, by: row.by,
    value: workspace ?? own ?? null, ...vault !== undefined && { secret: vault }, ...row.sealedWith.includes('own') && { personal: true }, ...row.deleted && { deleted: true },
  }
}

function valueOf({ value, secret, personal }: Patch & { personal?: boolean }): Value {
  return { [personal ? 'own' : 'workspace']: value, ...secret !== undefined && { vault: secret } }
}

async function clientNow(): Promise<RecordsClient> {
  const map = await seenMap()
  return cloud.records({
    sealer: await keyring.sealer(),
    roster: (workspace) => rosterOf(roomKeys.members(workspace)),
    seen: (id, collection) => map.get(keyOf({ collection, id })),
  })
}

function rosterOf(body: MemberListBody | undefined): Roster | null {
  return body ? { workspace: body.workspace, members: body.members, viewers: viewersOf(body), former: [] } : null
}

function seenMap(): Promise<Map<string, Seen>> {
  seen ??= db.selectFrom('record_held').selectAll().execute().then((rows) => new Map(rows.map((row) => [row.id, { ver: row.ver, parent: row.parent }])))
  return seen
}

async function reach<T>(step: () => Promise<T>, workspace?: string): Promise<T> {
  try {
    return await step()
  } catch (error) {
    if (workspace && error instanceof RecordsError && error.status === 403) refused(workspace)
    throw httpOf(error)
  }
}

function unreachable(error: unknown): boolean {
  if (error instanceof RecordsError) return error.status >= 500 || error.status === 429 || error.status === 0
  if (error instanceof HttpError) return error.status === 502
  return error instanceof TypeError
}

function httpOf(error: unknown): unknown {
  if (error instanceof RecordsError) return new HttpError(error.status >= 500 || error.status === 0 ? 502 : error.status, error.message)
  if (error instanceof TypeError) return new HttpError(502, `OpenHut Cloud didn’t answer (${error.message}). Check this computer’s internet connection.`)
  return error
}
