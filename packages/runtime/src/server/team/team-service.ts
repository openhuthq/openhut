import type { Me } from '@openhut/common/team/team.ts'
import { db } from '../platform/db.ts'
import { settings } from '../platform/settings.ts'
import type { Caller } from './identity.ts'

export const teamService = {
  async me({ caller }: { caller: Caller }): Promise<Me> {
    const person = await db.selectFrom('person').selectAll().where('id', '=', caller.id).executeTakeFirstOrThrow()
    return {
      object: 'me',
      user: { id: person.id, object: 'person', email: caller.email, joinedAt: new Date(person.created_at).toISOString() },
      timeZone: settings.timeZone(),
    }
  },
}
