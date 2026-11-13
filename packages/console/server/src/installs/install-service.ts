import { sql, type Selectable } from 'kysely'
import type { ListQuery } from '@jakebox/common/api.ts'
import type { CheckIn, CreateCheckIn, Install } from '@jakebox/common/console/console.ts'
import { db, type Database } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { pageOf } from '../platform/paging.ts'

export const installService = {
  async checkIn({ installId, build, version }: CreateCheckIn): Promise<CheckIn> {
    const row = await db.insertInto('install').values({ id: installId, build, version })
      .onConflict((oc) => oc.column('id')
        .doUpdateSet({ build, version, last_check_in_at: sql`now()` })
        .where('install.last_check_in_at', '<=', sql<Date>`now() - interval '1 minute'`))
      .returningAll().executeTakeFirst()
    if (!row) throw new HttpError(429, 'This install checked in less than a minute ago. Check again in a minute.')
    return { object: 'check_in', installId: row.id, build: row.build, version: row.version, createdAt: new Date(row.last_check_in_at).toISOString() }
  },

  async list(query: ListQuery): Promise<{ data: Install[]; hasMore: boolean }> {
    return pageOf({ table: 'install', query, objectOf: installOf })
  },
}

function installOf(row: Selectable<Database['install']>): Install {
  return {
    id: row.id, object: 'install', build: row.build, version: row.version,
    lastCheckInAt: new Date(row.last_check_in_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
  }
}
