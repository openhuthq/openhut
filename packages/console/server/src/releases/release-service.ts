import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import type { ListQuery } from '@jakebox/common/api.ts'
import type { CreateRelease, Release } from '@jakebox/common/console/console.ts'
import { db, type Database } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { pageOf } from '../platform/paging.ts'

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

  async list(query: ListQuery): Promise<{ data: Release[]; hasMore: boolean }> {
    return pageOf({ table: 'release', query, objectOf: releaseOf })
  },
}

function releaseOf(row: Selectable<Database['release']>): Release {
  return {
    id: row.id, object: 'release', build: row.build, version: row.version, sha256: row.sha256, url: row.url, notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
  }
}
