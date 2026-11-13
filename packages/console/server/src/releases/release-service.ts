import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import type { CreateRelease, ListConsoleObjects, Release } from '@jakebox/common/console/console.ts'
import { db, type Database } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'

const DEFAULT_LIMIT = 20

export const releaseService = {
  async create(input: CreateRelease): Promise<Release> {
    const row = await db.insertInto('release')
      .values({ id: `rel_${randomBytes(8).toString('hex')}`, build: input.build, version: input.version, sha256: input.sha256, url: input.url, notes: input.notes ?? '' })
      .onConflict((oc) => oc.column('build').doNothing())
      .returningAll().executeTakeFirst()
    if (!row) throw new HttpError(409, `Build ${input.build} is already registered. Release a new build instead.`, { param: 'build' })
    log.info({ event: 'release.registered', release: row.id, build: row.build })
    return releaseOf(row)
  },

  async list({ limit = DEFAULT_LIMIT, startingAfter }: ListConsoleObjects): Promise<{ data: Release[]; hasMore: boolean }> {
    let select = db.selectFrom('release').selectAll().orderBy('seq', 'desc').limit(limit + 1)
    if (startingAfter) select = select.where('seq', '<', await seqOf(startingAfter))
    const rows = await select.execute()
    return { data: rows.slice(0, limit).map(releaseOf), hasMore: rows.length > limit }
  },

  async latest(): Promise<Release> {
    const row = await db.selectFrom('release').selectAll().orderBy('seq', 'desc').executeTakeFirst()
    if (!row) throw new HttpError(404, 'No release is registered yet. Register one with POST /api/releases.')
    return releaseOf(row)
  },
}

async function seqOf(id: string): Promise<number> {
  const row = await db.selectFrom('release').select('seq').where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(400, `There's no release ${id}. Pass the id of a release from the list as startingAfter.`, { param: 'startingAfter' })
  return row.seq
}

function releaseOf(row: Selectable<Database['release']>): Release {
  return {
    id: row.id, object: 'release', build: row.build, version: row.version, sha256: row.sha256, url: row.url, notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
  }
}
