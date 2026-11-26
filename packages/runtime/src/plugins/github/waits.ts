import { asks } from '../../core/asks.ts'
import { github } from '../../server/integrations/github/github.ts'
import { connectionService } from '../../server/connections/connection-service.ts'
import { db } from '../../server/platform/db.ts'
import { listen, log } from '../../server/platform/events.ts'
import { messageOf } from '../../server/platform/http-error.ts'
import type { Caller } from '../../server/team/identity.ts'

const POLL_MS = 60_000
const WAIT_MS = 7 * 24 * 60 * 60_000

export const installWaits = {
  async add({ askId, actor, permissions }: { askId: string; actor: Caller; permissions: unknown }): Promise<void> {
    const known = (await github.installations()).map((each) => each.installationId)
    const row = { actor: JSON.stringify(actor), permissions: JSON.stringify(permissions ?? {}), known: JSON.stringify(known) }
    await db.insertInto('github_install_wait').values({ ask_id: askId, ...row }).onConflict((conflict) => conflict.column('ask_id').doUpdateSet(row)).execute()
  },

  async waiting({ askIds }: { askIds: string[] }): Promise<{ askId: string; since: string }[]> {
    if (!askIds.length) return []
    const rows = await db.selectFrom('github_install_wait').select(['ask_id', 'created_at']).where('ask_id', 'in', askIds).execute()
    return rows.map((row) => ({ askId: row.ask_id, since: new Date(row.created_at).toISOString() }))
  },

  async poll(): Promise<void> {
    await db.deleteFrom('github_install_wait').where('created_at', '<', new Date(Date.now() - WAIT_MS)).execute()
    const rows = await db.selectFrom('github_install_wait as w').innerJoin('ask as a', 'a.id', 'w.ask_id').select(['w.ask_id', 'w.actor', 'w.permissions', 'w.known', 'a.status']).execute()
    if (!rows.length || !github.app()) return
    const installations = await github.installations()
    for (const row of rows) {
      const known: number[] = JSON.parse(row.known)
      const fresh = installations.find((each) => !known.includes(each.installationId))
      if (row.status !== 'open') await db.deleteFrom('github_install_wait').where('ask_id', '=', row.ask_id).execute()
      if (row.status !== 'open' || !fresh) continue
      const actor = JSON.parse(row.actor) as Caller
      const { config, account } = await github.installed(fresh.installationId)
      const connection = await connectionService.save({ actor, kind: 'github', name: github.app()?.name ?? 'GitHub', config, account, signIn: false })
      await db.deleteFrom('github_install_wait').where('ask_id', '=', row.ask_id).execute()
      await asks.approve({ actor, id: row.ask_id, answer: { connectionId: connection.id, permissions: JSON.parse(row.permissions) } })
    }
  },

  start(): void {
    listen((event) => {
      if (event.name !== 'github.install_requested' || event.target?.type !== 'ask' || !event.actor) return
      const actor = event.actor as Caller
      void installWaits.add({ askId: event.target.id, actor, permissions: event.properties?.permissions }).catch((err: unknown) => log.warn({ event: 'github.install_wait_failed', error: messageOf(err) }))
    })
    setInterval(() => { void installWaits.poll().catch((err: unknown) => log.warn({ event: 'github.install_poll_failed', error: messageOf(err) })) }, POLL_MS).unref()
  },
}
