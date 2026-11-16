import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import { ADDRESS, type Channel, type Conversation, type CreateChannel, type UpdateChannel } from '@openhut/common/channels/channel.ts'
import { db, findRow, isUniqueViolation } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log, record } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import { deleted } from '../platform/responses.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { slack, SlackSecrets } from '../integrations/slack/slack.ts'
import { telegram } from '../integrations/telegram/telegram.ts'
import { agentService } from '../agents/agent-service.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from './audience.ts'

const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram' } as const

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
    const audience = body.kind === 'slack' ? { owner_address: '', open: false, allowed: '' } : { owner_address: body.ownerAddress, open: body.open, allowed: body.allowed.join(',') }
    const row = await db.insertInto('channel').values({ id: newId('ch'), agent_id: agent.id, kind: body.kind, ...audience, ...await setupOf({ body, agentName: agent.name, agentId: agent.id }) })
      .returningAll().executeTakeFirstOrThrow().catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(409, `${agent.name} already has ${LABEL[body.kind]}. Disconnect it first.`) : err })
    record({ action: 'channel.created', actor, target: { type: 'channel', id: row.id, kind: row.kind, agentId: agent.id } })
    await reapplyOrLog(agent.id)
    return channelOf({ row, qr: null })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateChannel }): Promise<Channel> {
    const row = await rowOf(id)
    const agent = await agentService.requireEditable({ actor, id: row.agent_id })
    const wrong = patch.allowed?.find((address) => !ADDRESS[row.kind].pattern.test(address))
    if (wrong) throw new HttpError(400, `${wrong} doesn't look right. ${ADDRESS[row.kind].message}`, { param: 'allowed' })
    if (row.kind === 'slack' && !patch.allowed) throw new HttpError(400, 'A Slack agent answers everyone in the channels you pick. Send allowed with the channel IDs.', { param: 'allowed' })
    const added = [...new Set(patch.allowed ?? [])].filter((address) => !audienceOf(row).allowed.includes(address))
    if (row.kind === 'slack') await slack.enter({ botToken: slackSecrets(row).botToken, ids: added, agentName: agent.name })
    const open = row.kind === 'slack' ? undefined : patch.open
    const updated = await db.updateTable('channel').set({ open, allowed: patch.allowed && [...new Set(patch.allowed)].join(',') }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    record({ action: 'channel.updated', actor, target: { type: 'channel', id, kind: row.kind, agentId: row.agent_id } })
    await reapplyOrLog(row.agent_id)
    if (row.kind === 'slack' && added.length) await greetOrLog({ row, ids: added, agentName: agent.name })
    return channelOf({ row: updated, qr: null })
  },

  async conversations({ actor, id }: { actor: Caller; id: string }): Promise<Conversation[]> {
    const row = await rowOf(id)
    await agentService.get({ actor, id: row.agent_id })
    if (row.kind !== 'slack') throw new HttpError(404, `Only Slack has channels to pick. This is ${LABEL[row.kind]}.`)
    return slack.conversations({ botToken: slackSecrets(row).botToken })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'channel'>> {
    const row = await rowOf(id)
    await agentService.requireEditable({ actor, id: row.agent_id })
    await disconnect(row)
    await db.deleteFrom('channel').where('id', '=', id).execute()
    record({ action: 'channel.deleted', actor, target: { type: 'channel', id, kind: row.kind, agentId: row.agent_id } })
    await reapplyOrLog(row.agent_id)
    return deleted({ id, object: 'channel' })
  },
}

async function setupOf({ body, agentName, agentId }: { body: CreateChannel; agentName: string; agentId: string }): Promise<{ status: 'connected' | 'linking'; account: string | null; secrets: string }> {
  switch (body.kind) {
    case 'slack': {
      const account = await slack.verify({ botToken: body.botToken, appToken: body.appToken })
      return { status: 'connected', account, secrets: seal(JSON.stringify({ botToken: body.botToken, appToken: body.appToken })) }
    }
    case 'telegram': {
      const account = await telegram.verify({ botToken: body.botToken })
      return { status: 'connected', account, secrets: seal(JSON.stringify({ botToken: body.botToken })) }
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
    case 'telegram': return
  }
}

async function greetOrLog({ row, ids, agentName }: { row: Row; ids: string[]; agentName: string }): Promise<void> {
  const failed = await slack.greet({ botToken: slackSecrets(row).botToken, ids, agentName }).catch((err: unknown) => [messageOf(err)])
  if (failed.length) log.warn({ event: 'channel.greet_failed', agent: row.agent_id, failed })
}

const slackSecrets = (row: Row) => SlackSecrets.parse(JSON.parse(unseal(row.secrets)))

async function reapplyOrLog(agentId: string): Promise<void> {
  await agentService.reapply({ id: agentId }).catch((err: unknown) => log.warn({ event: 'channel.reapply_failed', agent: agentId, error: messageOf(err) }))
}

const rowOf = (id: string): Promise<Row> => findRow({ table: 'channel', id, missing: 'That channel doesn\'t exist. It may have been disconnected.' })

function channelOf({ row, qr }: { row: Row; qr: string | null }): Channel {
  return {
    id: row.id, object: 'channel', agentId: row.agent_id, kind: row.kind, status: row.status, account: row.account, ...audienceOf(row), qr,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

type Row = Selectable<Database['channel']>
