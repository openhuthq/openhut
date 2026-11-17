import type { Me } from '@openhut/common/team/team.ts'
import { db } from '../platform/db.ts'

export const teamService = {
  async me({ personId }: { personId: string }): Promise<Me> {
    const person = await db.selectFrom('person').selectAll().where('id', '=', personId).executeTakeFirstOrThrow()
    return {
      object: 'me',
      user: { id: person.id, object: 'person', email: person.email, joinedAt: new Date(person.created_at).toISOString() },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  },
}
