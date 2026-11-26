import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import type { AddSecret, AgentSecret } from '@openhut/common/agents/secret.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { deleted } from '../platform/responses.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import type { Caller } from '../team/identity.ts'
import { apply } from './apply.ts'
import { agentService } from './agent-service.ts'

type Row = Selectable<Database['agent_secret']>
export type HeldSecret = { id: string; name: string; hosts: string[]; header: string; value: string }

export const secretService = {
  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<AgentSecret[]> {
    await agentService.requireVisible({ actor, id: agentId })
    const rows = await db.selectFrom('agent_secret').selectAll().where('agent_id', '=', agentId).orderBy('name').execute()
    return rows.map(secretOf)
  },

  async save({ agentId, input, value }: { agentId: string; input: AddSecret; value: string }): Promise<void> {
    await db.insertInto('agent_secret').values({ id: newId('sec'), agent_id: agentId, name: input.name, hosts: JSON.stringify(input.hosts), header: input.header, value: seal(value) })
      .onConflict((conflict) => conflict.columns(['agent_id', 'name']).doUpdateSet({ hosts: JSON.stringify(input.hosts), header: input.header, value: seal(value) })).execute()
    await reapply(agentId)
  },

  async replace({ actor, id, value }: { actor: Caller; id: string; value: string }): Promise<AgentSecret> {
    const row = await editable({ actor, id })
    const updated = await db.updateTable('agent_secret').set({ value: seal(value) }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow()
    emit({ name: 'agent_secret.replaced', actor, target: { type: 'agent_secret', id, agentId: row.agent_id } })
    return secretOf(updated)
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'agent_secret'>> {
    const row = await editable({ actor, id })
    await db.deleteFrom('agent_secret').where('id', '=', row.id).execute()
    emit({ name: 'agent_secret.deleted', actor, target: { type: 'agent_secret', id, agentId: row.agent_id } })
    await reapply(row.agent_id)
    return deleted({ id, object: 'agent_secret' })
  },

  async held({ agentId }: { agentId: string }): Promise<HeldSecret[]> {
    const rows = await db.selectFrom('agent_secret').selectAll().where('agent_id', '=', agentId).execute()
    return rows.map((row) => ({ id: row.id, name: row.name, hosts: hostsOf(row), header: row.header, value: unseal(row.value) }))
  },

  async used({ ids }: { ids: string[] }): Promise<void> {
    if (ids.length) await db.updateTable('agent_secret').set({ used_at: new Date() }).where('id', 'in', ids).execute()
  },
}

async function editable({ actor, id }: { actor: Caller; id: string }): Promise<Row> {
  const row = await db.selectFrom('agent_secret').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(404, 'That key doesn\'t exist. It may have been removed.')
  await agentService.requireOwner({ actor, id: row.agent_id })
  return row
}

async function reapply(agentId: string): Promise<void> {
  await apply.request(agentId).catch((err: unknown) => log.warn({ event: 'agent.reapply_failed', agent: agentId, error: messageOf(err) }))
}

const hostsOf = (row: Pick<Row, 'hosts'>): string[] => JSON.parse(row.hosts) as string[]

function secretOf(row: Row): AgentSecret {
  return {
    id: row.id, object: 'agent_secret', agentId: row.agent_id, name: row.name, hosts: hostsOf(row), header: row.header,
    createdAt: row.created_at.toISOString(), usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
  }
}
