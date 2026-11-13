import type { Selectable } from 'kysely'
import { ADDRESS, type Channel, type CreateChannel, type UpdateChannel } from '@jakebox/common/channels/channel.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log, record } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId, seal } from '../platform/secrets.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { slack } from '../integrations/slack/slack.ts'
import { agentService } from '../agents/agent-service.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from './audience.ts'

const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp' } as const

export const channelService = {
  async list({ agentId }: { agentId?: string }): Promise<Channel[]> {
    let select = db.selectFrom('channel').selectAll().orderBy('created_at')
    if (agentId) select = select.where('agent_id', '=', agentId)
    return (await select.execute()).map((row) => channelOf({ row, qr: null }))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Channel> {
    const row = await rowOf(id)
    if (row.kind !== 'whatsapp' || row.status !== 'linking') return channelOf({ row, qr: null })
    if (!(await agentService.get({ actor, id: row.agent_id })).canEdit) return channelOf({ row, qr: null })
    const pairing = await agentd.pairWhatsapp({ id: row.agent_id })
    if (pairing.status === 'error') throw new HttpError(502, `WhatsApp linking stopped (${pairing.error}). Close this and link again.`)
    if (pairing.status !== 'linked') return channelOf({ row, qr: pairing.qr ?? null })
    const linked = await db.updateTable('channel').set({ status: 'connected', account: pairing.phone ? `+${pairing.phone}` : null }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    return channelOf({ row: linked, qr: null })
  },

  async create({ actor, ...body }: CreateChannel & { actor: Caller }): Promise<Channel> {
    const agent = await agentService.requireEditable({ actor, id: body.agentId })
    const existing = await db.selectFrom('channel').select('id').where('agent_id', '=', agent.id).where('kind', '=', body.kind).executeTakeFirst()
    if (existing) throw new HttpError(409, `${agent.name} already has ${LABEL[body.kind]}. Disconnect it first.`)
    const audience = { owner_address: body.ownerAddress, open: body.open, allowed: body.allowed.join(',') }
    const row = await db.insertInto('channel').values({ id: newId('ch'), agent_id: agent.id, kind: body.kind, ...audience, ...await setupOf({ body, agentName: agent.name, agentId: agent.id }) })
      .returningAll().executeTakeFirstOrThrow().catch((err: unknown) => {
        if (isUniqueViolation(err)) throw new HttpError(409, `${agent.name} already has ${LABEL[body.kind]}. Disconnect it first.`)
        throw err
      })
    record({ action: 'channel.created', actor, target: { type: 'channel', id: row.id, kind: row.kind, agentId: agent.id } })
    await reapplyOrLog(agent.id)
    return channelOf({ row, qr: null })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateChannel }): Promise<Channel> {
    const row = await rowOf(id)
    await agentService.requireEditable({ actor, id: row.agent_id })
    const wrong = patch.allowed?.find((address) => !ADDRESS[row.kind].pattern.test(address))
    if (wrong) throw new HttpError(400, `${wrong} doesn't look right. ${ADDRESS[row.kind].message}`, { param: 'allowed' })
    const changes: { open?: boolean; allowed?: string } = {}
    if (patch.open !== undefined) changes.open = patch.open
    if (patch.allowed) changes.allowed = patch.allowed.join(',')
    if (!Object.keys(changes).length) throw new HttpError(400, 'Send at least one field to change.')
    const updated = await db.updateTable('channel').set(changes).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    record({ action: 'channel.updated', actor, target: { type: 'channel', id, kind: row.kind, agentId: row.agent_id } })
    await reapplyOrLog(row.agent_id)
    return channelOf({ row: updated, qr: null })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    const row = await rowOf(id)
    await agentService.requireEditable({ actor, id: row.agent_id })
    await disconnect(row)
    await db.deleteFrom('channel').where('id', '=', id).execute()
    record({ action: 'channel.deleted', actor, target: { type: 'channel', id, kind: row.kind, agentId: row.agent_id } })
    await reapplyOrLog(row.agent_id)
  },
}

async function setupOf({ body, agentName, agentId }: { body: CreateChannel; agentName: string; agentId: string }): Promise<{ status: 'connected' | 'linking'; account: string | null; secrets: string }> {
  switch (body.kind) {
    case 'slack': {
      const account = await slack.verify({ botToken: body.botToken, appToken: body.appToken })
      return { status: 'connected', account, secrets: seal(JSON.stringify({ botToken: body.botToken, appToken: body.appToken })) }
    }
    case 'whatsapp': {
      if ((await containerStates())?.[agentId] !== 'running') throw new HttpError(409, `Start ${agentName} first: WhatsApp links from inside its container.`)
      return { status: 'linking', account: null, secrets: '' }
    }
  }
}

async function disconnect(row: Row): Promise<void> {
  switch (row.kind) {
    case 'whatsapp': await agentd.unlinkWhatsapp({ id: row.agent_id }); return
    case 'slack': return
  }
}

async function reapplyOrLog(agentId: string): Promise<void> {
  await agentService.reapply({ id: agentId }).catch((err: Error) => log.warn({ event: 'channel.reapply_failed', agent: agentId, error: err.message }))
}

async function rowOf(id: string): Promise<Row> {
  const row = /^ch_[a-z0-9]{8}$/.test(id) ? await db.selectFrom('channel').selectAll().where('id', '=', id).executeTakeFirst() : undefined
  if (!row) throw new HttpError(404, 'That channel doesn\'t exist. It may have been disconnected.')
  return row
}

function channelOf({ row, qr }: { row: Row; qr: string | null }): Channel {
  return {
    id: row.id, object: 'channel', agentId: row.agent_id, kind: row.kind, status: row.status, account: row.account, ...audienceOf(row), qr,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

type Row = Selectable<Database['channel']>
