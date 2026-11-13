import type { Selectable } from 'kysely'
import { sql } from 'kysely'
import type { CheckIn, Install, ListConsoleObjects } from '@jakebox/common/console/console.ts'
import { db, type Database } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'

const DEFAULT_LIMIT = 20

export const installService = {
  async checkIn({ installId, build, version }: CheckIn): Promise<Install> {
    const row = await db.insertInto('install').values({ id: installId, build, version })
      .onConflict((oc) => oc.column('id')
        .doUpdateSet({ build, version, last_check_in_at: sql`now()` })
        .where('install.last_check_in_at', '<=', sql<Date>`now() - interval '1 minute'`))
      .returningAll().executeTakeFirst()
    if (!row) throw new HttpError(429, 'This install checked in less than a minute ago. Check again in a minute.')
    return installOf(row)
  },

  async list({ limit = DEFAULT_LIMIT, startingAfter }: ListConsoleObjects): Promise<{ data: Install[]; hasMore: boolean }> {
    let select = db.selectFrom('install').selectAll().orderBy('seq', 'desc').limit(limit + 1)
    if (startingAfter) select = select.where('seq', '<', await seqOf(startingAfter))
    const rows = await select.execute()
    return { data: rows.slice(0, limit).map(installOf), hasMore: rows.length > limit }
  },
}

async function seqOf(id: string): Promise<number> {
  const row = await db.selectFrom('install').select('seq').where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(400, `There's no install ${id}. Pass the id of an install from the list as startingAfter.`, { param: 'startingAfter' })
  return row.seq
}

function installOf(row: Selectable<Database['install']>): Install {
  return {
    id: row.id, object: 'install', build: row.build, version: row.version,
    lastCheckInAt: new Date(row.last_check_in_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
  }
}
