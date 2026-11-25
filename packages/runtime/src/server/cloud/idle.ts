// C3: is this Cloud computer busy? The Cloud stops it after 2 minutes of idle beats (cloud-events.ts sends this with each beat).
// Busy: a turn in flight (a long shell call runs inside one), gateway traffic in the last minute, or a channel that holds its own
// socket (Slack, Discord, WhatsApp) and so can't be woken. An open chat with nothing running is idle.
import { db } from '../platform/db.ts'
import { activity } from '../gateway/activity.ts'
import { busy as turns } from '../threads/thread-service.ts'

const QUIET_MS = 60_000

export async function busy(): Promise<boolean> {
  if (turns.size > 0 || activity.recent(QUIET_MS)) return true
  return Boolean(await db.selectFrom('channel').select('id').where('kind', 'in', ['slack', 'discord', 'whatsapp']).executeTakeFirst())
}
