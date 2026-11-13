import { sql, type Selectable } from 'kysely'
import type { ListQuery } from '@jakebox/common/api.ts'
import { db, type Database } from './db.ts'
import { HttpError } from './http-error.ts'

const DEFAULT_LIMIT = 10

export async function pageOf<T extends keyof Database, O>({ table, query, objectOf }: { table: T; query: ListQuery; objectOf: (row: Selectable<Database[T]>) => O }): Promise<{ data: O[]; hasMore: boolean }> {
  if (query.startingAfter && query.endingBefore) throw new HttpError(400, 'Send startingAfter or endingBefore, not both.', { param: 'endingBefore' })
  const limit = query.limit ?? DEFAULT_LIMIT
  const backwards = query.endingBefore !== undefined
  const after = query.startingAfter ? sql`and seq < ${await seqOf({ table, id: query.startingAfter, param: 'startingAfter' })}` : sql``
  const before = query.endingBefore ? sql`and seq > ${await seqOf({ table, id: query.endingBefore, param: 'endingBefore' })}` : sql``
  const order = backwards ? sql`asc` : sql`desc`
  const { rows } = await sql<Selectable<Database[T]>>`select * from ${sql.table(table)} where true ${after} ${before} order by seq ${order} limit ${limit + 1}`.execute(db)
  const page = rows.slice(0, limit)
  return { data: (backwards ? page.reverse() : page).map(objectOf), hasMore: rows.length > limit }
}

async function seqOf({ table, id, param }: { table: keyof Database; id: string; param: string }): Promise<number> {
  const row = await sql<{ seq: number }>`select seq from ${sql.table(table)} where id = ${id}`.execute(db)
  if (!row.rows.length) throw new HttpError(400, `There's no ${table} ${id}. Pass the id of a ${table} from the list as ${param}.`, { param })
  return row.rows[0].seq
}
