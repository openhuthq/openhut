import { sql } from 'kysely'
import * as z from 'zod/mini'
import { RecordsError, recordsClient, type RecordsClient } from '@openhut/common/records/client.ts'
import { signer, type Keyring, type Opened, type Value } from '@openhut/common/records/seal.ts'
import { COLLECTIONS, type Collection } from '@openhut/common/records/wire.ts'
import type { Bytes } from '@openhut/common/vault/vault.ts'
import { config } from '../platform/config.ts'
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

export const recordsService = {
  async list({ collection, workspace, parent }: { collection: Collection; workspace: string; parent?: string }): Promise<Held[]> {
    const records = await clientNow()
    const all: Held[] = []
    for (let startingAfter: string | undefined, more = true; more;) {
      const page = await reach(() => records.list({ collection, workspace, parent, startingAfter }))
      for (const row of page.data) all.push(await keep(row))
      startingAfter = page.next ?? undefined
      more = page.next !== null
    }
    return all.filter((each) => !each.deleted)
  },

  async get({ collection, workspace, id }: { collection: Collection; workspace: string; id: string }): Promise<Held | null> {
    const records = await clientNow()
    const row = await reach(() => records.get({ collection, workspace, id }))
    return row && keep(row)
  },

  put: (input: PutRecord): Promise<Held | null> => send({ ...input, id: idOf(input) }),

  async remove({ collection, workspace, id, queue }: { collection: Collection; workspace: string; id: string; queue?: boolean }): Promise<void> {
    const held = (await seenMap()).get(id) ?? await recordsService.get({ collection, workspace, id }).then((row) => row && { parent: row.parent ?? null })
    if (held) await send({ collection, workspace, id, parent: held.parent ?? undefined, value: null, queue, deleted: true })
  },

  held: async (id: string): Promise<number> => (await seenMap()).get(id)?.ver ?? 0,

  onChange(listener: (change: Change) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  drain(): Promise<void> {
    draining = draining.then(drainOnce).catch((err: unknown) => log.warn({ event: 'records.drain_failed', error: messageOf(err) }))
    return draining
  },
}

export function idOf(input: PutRecord): string {
  return input.id === undefined ? input.parent : input.id
}

export function changed(change: Change): void {
  for (const listener of listeners) listener(change)
}

async function send(input: Write): Promise<Held | null> {
  const waiting = await db.selectFrom('record_outbox').select('seq').where('id', '=', input.id).executeTakeFirst()
  if (input.queue && waiting) return queue(input).then(() => null)
  try {
    const saved = await write(input)
    if (waiting) await db.deleteFrom('record_outbox').where('id', '=', input.id).execute()
    return saved
  } catch (error) {
    if (input.queue && unreachable(error)) return queue(input).then(() => null)
    throw httpOf(error)
  }
}

async function write({ collection, id, workspace, parent, value, secret, personal, reapply, deleted }: Write): Promise<Held> {
  const records = await clientNow()
  const where = { collection, workspace, parent: parent ?? null, id, current: (await seenMap()).get(id)?.ver ?? 0 }
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
  await db.insertInto('record_outbox').values({ id, collection, workspace, parent: parent ?? null, body, deleted })
    .onConflict((oc) => oc.column('id').doUpdateSet({ body, deleted, parent: parent ?? null })).execute()
  log.warn({ event: 'records.queued', collection, id })
}

async function drainOnce(): Promise<void> {
  for (const row of await db.selectFrom('record_outbox').selectAll().orderBy('seq').execute()) {
    const queued = z.parse(Queued, JSON.parse(unseal(row.body)))
    const input = { ...queued, collection: z.parse(z.enum(COLLECTIONS), row.collection), id: row.id, workspace: row.workspace, parent: row.parent ?? undefined, deleted: row.deleted }
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
  if ((map.get(row.id)?.ver ?? 0) < row.ver) {
    map.set(row.id, { ver: row.ver, parent: row.parent })
    await db.insertInto('record_held').values({ id: row.id, ver: row.ver, parent: row.parent })
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
  const own = new Map(await Promise.all(roomKeys.rooms().map(async (room) => [room.workspace.id, await roomKeys.own(room.workspace.id)] as const)))
  const vault = keysService.vault()
  const map = await seenMap()
  const ring = (key: Bytes | null | undefined): Keyring | null => key ? { version: 1, keys: { 1: key } } : null
  return recordsClient({
    baseUrl: config.apiUrl,
    token: () => keysService.token(),
    device: signer(await keysService.device()),
    keys: ({ use, workspace }) => {
      if (use === 'own') return ring(own.get(workspace))
      if (use === 'vault') return ring(vault)
      const found = roomKeys.room(workspace)?.workspace
      return found?.key ? { version: found.version, keys: roomKeys.ring(workspace) } : null
    },
    roster: (workspace) => roomKeys.members(workspace),
    seen: (id) => map.get(id),
  })
}

function seenMap(): Promise<Map<string, Seen>> {
  seen ??= db.selectFrom('record_held').selectAll().execute().then((rows) => new Map(rows.map((row) => [row.id, { ver: row.ver, parent: row.parent }])))
  return seen
}

async function reach<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (error) {
    throw httpOf(error)
  }
}

function unreachable(error: unknown): boolean {
  if (error instanceof RecordsError) return error.status >= 500 || error.status === 429
  if (error instanceof HttpError) return error.status === 502
  return error instanceof TypeError
}

function httpOf(error: unknown): unknown {
  if (error instanceof RecordsError) return new HttpError(error.status >= 500 ? 502 : error.status, error.message)
  if (error instanceof TypeError) return new HttpError(502, `OpenHut Cloud didn’t answer (${error.message}). Check this computer’s internet connection.`)
  return error
}
