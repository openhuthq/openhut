import { sql } from 'kysely'
import type { AgentRecord, ControlRecord } from '@openhut/common/agents/agent.ts'
import type { ChannelRecord } from '@openhut/common/channels/channel.ts'
import type { RoutineRecord } from '@openhut/common/routines/routine.ts'
import { memoryService } from '../agents/memory-service.ts'
import { skillService } from '../agents/skill-service.ts'
import { audienceOf } from '../channels/audience.ts'
import { db } from '../platform/db.ts'
import { log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { unseal } from '../platform/secrets.ts'
import { threadService } from '../threads/thread-service.ts'
import { keysService } from './keys-service.ts'
import { recordsService } from './records.ts'
import { roomKeys } from './room-keys.ts'

const DONE = 'records_uploaded'
const uploaders: (() => Promise<void>)[] = []
let connectionIdOf = (id: string): string | Promise<string> => id

export const upgrade = {
  done: async (): Promise<boolean> => !!await db.selectFrom('install_setting').select('value').where('name', '=', DONE).executeTakeFirst(),

  also(uploader: () => Promise<void>): void {
    uploaders.push(uploader)
  },

  mapConnections(map: typeof connectionIdOf): void {
    connectionIdOf = map
  },

  async run(): Promise<void> {
    if (await upgrade.done()) return
    const account = keysService.signedIn()
    const me = await keysService.deviceKey()
    const rows = await db.selectFrom('agent').selectAll().where((eb) => eb.or([eb('runs_on', 'is', null), eb('runs_on', '=', me)])).orderBy('created_at').execute()
    for (const row of rows) {
      if (row.owner && row.owner !== account.email) {
        log.warn({ event: 'upgrade.not_mine', agent: row.id, owner: row.owner })
        continue
      }
      const workspace = row.workspace && roomKeys.room(row.workspace) ? row.workspace : account.workspace.id
      const personal = !row.shared
      const place = { workspace, parent: row.id, personal }
      let there = false
      const value: AgentRecord = { name: row.name, instructions: row.instructions, face: row.face, wanted: row.wanted, createdAt: new Date(row.created_at).toISOString() }
      await recordsService.put({ collection: 'agent', id: row.id, workspace, parent: account.email, personal, value, reapply: () => { there = true; return null } })
      if (there) continue
      const grants = await db.selectFrom('connection_grant').select(['connection_id', 'created_at']).where('agent_id', '=', row.id).execute()
      const control: ControlRecord = { runsOn: me, model: row.model, codeExecution: row.code_execution, browser: row.web_browser, grants: await Promise.all(grants.map(async (grant) => ({ connection: await connectionIdOf(grant.connection_id), at: new Date(grant.created_at).toISOString() }))), people: [], sidebars: [] }
      await recordsService.put({ collection: 'control', ...place, value: control })
      for (const channel of await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).execute()) {
        const record: ChannelRecord = { kind: channel.kind, status: channel.status, account: channel.account, ...audienceOf(channel), createdAt: new Date(channel.created_at).toISOString() }
        await recordsService.put({ collection: 'channel', id: channel.id, ...place, value: record, ...channel.secrets && { secret: JSON.parse(unseal(channel.secrets)) } })
      }
      for (const routine of await db.selectFrom('routine').selectAll().where('agent_id', '=', row.id).execute()) {
        const record: RoutineRecord = { name: routine.name, plan: routine.plan, at: iso(routine.at), cron: routine.cron, until: iso(routine.until), origin: routine.origin, createdAt: new Date(routine.created_at).toISOString() }
        await recordsService.put({ collection: 'routine', id: routine.id, ...place, value: record })
      }
      await memoryService.backUp({ agentId: row.id }).catch((err: unknown) => log.warn({ event: 'upgrade.memory_failed', agent: row.id, error: messageOf(err) }))
      await skillService.backUp({ agentId: row.id }).catch((err: unknown) => log.warn({ event: 'upgrade.skills_failed', agent: row.id, error: messageOf(err) }))
    }
    await threadService.uploadThreads()
    for (const uploader of uploaders) await uploader()
    await recordsService.drain()
    await sql`drop table if exists thread`.execute(db)
    await db.insertInto('install_setting').values({ name: DONE, value: new Date().toISOString() }).onConflict((oc) => oc.column('name').doNothing()).execute()
    log.info({ event: 'upgrade.uploaded', agents: rows.length })
  },
}

const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null
