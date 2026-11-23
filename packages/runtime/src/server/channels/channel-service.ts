import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import { ADDRESS, ChannelRecord, ChannelSecrets, type Channel, type Conversation, type CreateChannel, type UpdateChannel } from '@openhut/common/channels/channel.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log, emit } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import { deleted } from '../platform/responses.ts'
import { agentd, containerStates, features } from '../platform/agentd.ts'
import { slack, SlackSecrets } from '../integrations/slack/slack.ts'
import { telegram, TelegramSecrets } from '../integrations/telegram/telegram.ts'
import { agentService, placeOf, type AgentFacts } from '../agents/agent-service.ts'
import { recordsService, type Held } from '../cloud/records.ts'
import { roomKeys } from '../cloud/room-keys.ts'
import { runSet } from '../cloud/run-set.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from './audience.ts'
import { whatsappPairing } from './whatsapp-pairing.ts'

const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram' } as const

export const channelService = {
  async list({ agentId }: { agentId?: string }): Promise<Channel[]> {
    if (agentId) {
      const facts = await agentService.find({ id: agentId })
      return channelsOf(await recordsService.list({ collection: 'channel', workspace: facts.workspace, parent: agentId }))
    }
    const all = await Promise.all(roomKeys.rooms().map((room) => recordsService.list({ collection: 'channel', workspace: room.workspace.id })))
    return channelsOf(all.flat())
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Channel> {
    const row = await db.selectFrom('channel').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) return channelOf({ held: await recordOf(id), qr: null })
    if (row.kind !== 'whatsapp' || row.status !== 'linking') return rowChannel({ row, qr: null })
    const agent = await agentService.requireEditable({ actor, id: row.agent_id }).catch(() => null)
    if (!agent || (agent.owner ?? actor.email) !== actor.email) return rowChannel({ row, qr: null })
    const pairing = whatsappPairing.follow(row.agent_id)
    if (pairing.status === 'error') throw new HttpError(502, `WhatsApp didn't connect (${pairing.error}). Close this and try again.`)
    if (pairing.status !== 'linked') return rowChannel({ row, qr: pairing.qr ?? null })
    const linked = await db.updateTable('channel').set({ status: 'connected', account: pairing.phone ? `+${pairing.phone}` : null }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    const value: ChannelRecord = { kind: linked.kind, status: 'connected', account: linked.account, ...audienceOf(linked), createdAt: new Date(linked.created_at).toISOString() }
    await recordsService.put({ collection: 'channel', id, parent: linked.agent_id, ...placeOf(agent), value, queue: true, reapply: (latest) => ({ value: { ...ChannelRecord.parse(latest.value), status: 'connected', account: linked.account }, secret: latest.secret }) })
    emit({ name: 'channel.linked', actor, target: { type: 'channel', id, kind: linked.kind, agentId: linked.agent_id } })
    return rowChannel({ row: linked, qr: null })
  },

  async create({ actor, ...body }: CreateChannel & { actor: Caller }): Promise<Channel> {
    const facts = await owned({ actor, agentId: body.agentId })
    const name = facts.value.name
    const existing = channelsOf(await recordsService.list({ collection: 'channel', workspace: facts.workspace, parent: facts.id }))
    if (existing.some((channel) => channel.kind === body.kind)) throw new HttpError(409, `${name} already has ${LABEL[body.kind]}. Disconnect it first.`)
    const audience = body.kind === 'slack' ? { ownerAddress: '', open: false, allowed: [] } : { ownerAddress: body.ownerAddress, open: body.open, allowed: body.allowed }
    const { status, account, secret } = await setupOf({ body, facts })
    const id = newId('ch')
    const held = await recordsService.put({ collection: 'channel', id, parent: facts.id, workspace: facts.workspace, personal: facts.personal, value: { kind: body.kind, status, account, ...audience, createdAt: new Date().toISOString() } satisfies ChannelRecord, secret })
    emit({ name: 'channel.created', actor, target: { type: 'channel', id, kind: body.kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    return channelOf({ held: held ?? await recordOf(id), qr: null })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateChannel }): Promise<Channel> {
    const held = await recordOf(id)
    const current = ChannelRecord.parse(held.value)
    const facts = await owned({ actor, agentId: held.parent ?? '' })
    const wrong = patch.allowed?.find((address) => !ADDRESS[current.kind].pattern.test(address))
    if (wrong) throw new HttpError(400, `${wrong} doesn't look right. ${ADDRESS[current.kind].message}`, { param: 'allowed' })
    if (current.kind === 'slack' && !patch.allowed) throw new HttpError(400, 'A Slack agent answers everyone in the channels you pick. Send allowed with the channel IDs.', { param: 'allowed' })
    const change = (value: ChannelRecord): ChannelRecord => ({ ...value, ...patch.allowed && { allowed: [...new Set(patch.allowed)] }, ...current.kind !== 'slack' && patch.open !== undefined && { open: patch.open } })
    const saved = await recordsService.put({ collection: 'channel', id, parent: facts.id, workspace: facts.workspace, personal: facts.personal, value: change(current), secret: held.secret, reapply: (latest) => ({ value: change(ChannelRecord.parse(latest.value)), secret: latest.secret }) })
    emit({ name: 'channel.updated', actor, target: { type: 'channel', id, kind: current.kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    return channelOf({ held: saved ?? held, qr: null })
  },

  async telegramToken({ agentId }: { agentId: string }): Promise<string> {
    const row = await db.selectFrom('channel').select('secrets').where('agent_id', '=', agentId).where('kind', '=', 'telegram').executeTakeFirst()
    if (!row) throw new HttpError(409, 'This agent has no Telegram bot. Connect one on its page first.')
    return TelegramSecrets.parse(JSON.parse(unseal(row.secrets))).botToken
  },

  async slackToken({ agentId }: { agentId: string }): Promise<string | undefined> {
    const row = await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).where('kind', '=', 'slack').executeTakeFirst()
    return row && slackSecrets(row).botToken
  },

  async conversations({ id }: { actor: Caller; id: string }): Promise<Conversation[]> {
    const held = await recordOf(id)
    const kind = ChannelRecord.parse(held.value).kind
    const botToken = ChannelSecrets.safeParse(held.secret).data?.botToken
    if (kind !== 'slack' || !botToken) throw new HttpError(404, `Only Slack has channels to pick. This is ${LABEL[kind]}.`)
    return slack.conversations({ botToken })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'channel'>> {
    const held = await recordOf(id)
    const facts = await owned({ actor, agentId: held.parent ?? '' })
    await recordsService.remove({ collection: 'channel', workspace: facts.workspace, id })
    emit({ name: 'channel.deleted', actor, target: { type: 'channel', id, kind: ChannelRecord.parse(held.value).kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    return deleted({ id, object: 'channel' })
  },

  async agentOf({ id }: { id: string }): Promise<string | undefined> {
    const row = await db.selectFrom('channel').select('agent_id').where('id', '=', id).executeTakeFirst()
    return row?.agent_id ?? (await recordOf(id).catch(() => null))?.parent
  },

  async applyRecords({ agentId, records }: { agentId: string; records: Held[] }): Promise<() => Promise<void>> {
    const greetings: { botToken: string; ids: string[] }[] = []
    const wanted = new Set<string>()
    for (const held of records) {
      const value = ChannelRecord.safeParse(held.value).data
      if (!value) continue
      wanted.add(held.id)
      const before = await db.selectFrom('channel').selectAll().where('id', '=', held.id).executeTakeFirst()
      const secret = ChannelSecrets.safeParse(held.secret).data
      const fields = { kind: value.kind, status: before?.status === 'connected' ? 'connected' as const : value.status, account: before?.account ?? value.account, owner_address: value.ownerAddress, open: value.open, allowed: value.allowed.join(','), secrets: secret?.botToken ? seal(JSON.stringify(secret)) : '' }
      await db.insertInto('channel').values({ id: held.id, agent_id: agentId, ...fields, created_at: value.createdAt }).onConflict((oc) => oc.column('id').doUpdateSet(fields)).execute()
      const added = value.allowed.filter((address) => !before || !audienceOf(before).allowed.includes(address))
      if (value.kind === 'slack' && secret?.botToken && before && added.length) greetings.push({ botToken: secret.botToken, ids: added })
    }
    for (const row of await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).execute()) {
      if (wanted.has(row.id) || await recordsService.held(row.id) === 0) continue
      await disconnect(row)
      await db.deleteFrom('channel').where('id', '=', row.id).execute()
    }
    return async () => {
      const agentName = (await db.selectFrom('agent').select('name').where('id', '=', agentId).executeTakeFirst())?.name ?? 'Your agent'
      for (const { botToken, ids } of greetings) {
        const failed = await slack.enter({ botToken, ids, agentName }).then(() => slack.greet({ botToken, ids, agentName })).catch((err: unknown) => [messageOf(err)])
        if (failed.length) log.warn({ event: 'channel.greet_failed', agent: agentId, failed })
      }
    }
  },
}

async function owned({ actor, agentId }: { actor: Caller; agentId: string }): Promise<AgentFacts> {
  const facts = await agentService.find({ id: agentId })
  if (facts.owner !== actor.email) throw new HttpError(403, `Only ${facts.owner} can change where ${facts.value.name} talks.`)
  return facts
}

async function recordOf(id: string): Promise<Held> {
  const row = await db.selectFrom('channel').select('agent_id').where('id', '=', id).executeTakeFirst()
  const first = row ? (await agentService.find({ id: row.agent_id }).catch(() => null))?.workspace : undefined
  for (const workspace of [...new Set([first, ...roomKeys.rooms().map((room) => room.workspace.id)])]) {
    const held = workspace ? await recordsService.get({ collection: 'channel', workspace, id }) : null
    if (held && !held.deleted) return held
  }
  throw new HttpError(404, 'That channel doesn\'t exist. It may have been disconnected.')
}

async function setupOf({ body, facts }: { body: CreateChannel; facts: AgentFacts }): Promise<{ status: 'connected' | 'linking'; account: string | null; secret?: ChannelSecrets }> {
  switch (body.kind) {
    case 'slack': {
      const account = await slack.verify({ botToken: body.botToken, appToken: body.appToken, configToken: body.configToken, icon: body.icon, agentName: facts.value.name })
      return { status: 'connected', account, secret: { botToken: body.botToken, appToken: body.appToken } }
    }
    case 'telegram': {
      const account = await telegram.verify({ botToken: body.botToken })
      return { status: 'connected', account, secret: { botToken: body.botToken } }
    }
    case 'whatsapp': {
      if (facts.row && !(await features()).whatsapp) throw new HttpError(409, 'This computer can\'t link WhatsApp. Run the agent on a Linux computer you added to use it.', { param: 'kind' })
      if (facts.row && (await containerStates())?.[facts.id] !== 'running') throw new HttpError(409, `Start ${facts.value.name} first, then connect WhatsApp.`)
      return { status: 'linking', account: null }
    }
  }
}

async function disconnect(row: Row): Promise<void> {
  switch (row.kind) {
    case 'whatsapp':
      whatsappPairing.stop(row.agent_id)
      await agentd.delete({ id: row.agent_id, paths: ['platforms/whatsapp/session'] }).catch((err: unknown) => log.warn({ event: 'channel.disconnect_failed', agent: row.agent_id, error: messageOf(err) }))
      return
    case 'slack': return
    case 'telegram': return
  }
}

const slackSecrets = (row: Row) => SlackSecrets.parse(JSON.parse(unseal(row.secrets)))

function channelsOf(records: Held[]): Channel[] {
  return records.flatMap((held) => ChannelRecord.safeParse(held.value).success ? [channelOf({ held, qr: null })] : []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function channelOf({ held, qr }: { held: Held; qr: string | null }): Channel {
  const value = ChannelRecord.parse(held.value)
  return { id: held.id, object: 'channel', agentId: held.parent ?? '', kind: value.kind, status: value.status, account: value.account, ownerAddress: value.ownerAddress, open: value.open, allowed: value.allowed, qr, createdAt: value.createdAt }
}

function rowChannel({ row, qr }: { row: Row; qr: string | null }): Channel {
  return { id: row.id, object: 'channel', agentId: row.agent_id, kind: row.kind, status: row.status, account: row.account, ...audienceOf(row), qr, createdAt: new Date(row.created_at).toISOString() }
}

type Row = Selectable<Database['channel']>
