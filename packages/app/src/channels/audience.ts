import type { Selectable } from 'kysely'
import type { Audience } from '@fastmonkey/common/channels/channel.ts'
import type { Database } from '../platform/db-schema.ts'

export const audienceOf = (row: Pick<Selectable<Database['channel']>, 'owner_address' | 'open' | 'allowed'>): Audience =>
  ({ ownerAddress: row.owner_address, open: row.open, allowed: row.allowed ? row.allowed.split(',') : [] })
