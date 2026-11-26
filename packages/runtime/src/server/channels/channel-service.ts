import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import { ADDRESS, ChannelRecord, ChannelSecrets, type Channel, type ChannelKind, type Conversation, type CreateChannel, type TelegramInvite, type UpdateChannel } from '@openhut/common/channels/channel.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log, emit } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import { deleted } from '../platform/responses.ts'
import { agentd, containerStates, features } from '../platform/agentd.ts'
import { slack, SlackSecrets } from '../integrations/slack/slack.ts'
import { telegram, TelegramSecrets } from '../integrations/telegram/telegram.ts'
import { discord } from '../integrations/discord/discord.ts'
import { agentService, placeOf, type AgentFacts } from '../agents/agent-service.ts'
import { recordsService, type Held } from '../platform/records.ts'
import { HOME } from '../team/home.ts'
import { runSet } from '../agents/run-set.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from './audience.ts'
import { whatsappPairing } from './whatsapp-pairing.ts'
import { telegramCodes, welcome, type Person } from './telegram-codes.ts'

const CHANNEL_KINDS = new Set<ChannelKind>(['slack', 'discord'])
const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord' } as const

export const channelService = {
  async list({ agentId }: { agentId?: string }): Promise<Channel[]> {
    if (agentId) {
      const facts = await agentService.find({ id: agentId })
      return channelsOf(await recordsService.list({ collection: 'channel', workspace: facts.workspace, parent: agentId }))
    }
    return channelsOf(await recordsService.list({ collection: 'channel', workspace: HOME }))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Channel> {
    const row = await db.selectFrom('channel').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) return channelOf({ held: await recordOf(id), qr: null })
    if (row.kind === 'telegram' && row.status === 'linking') return channelOf({ held: await recordOf(id), qr: await owned({ actor, agentId: row.agent_id }).then(() => claimLink(row), () => null) })
    if (row.kind === 'telegram') return channelOf({ held: await recordOf(id), qr: null })
    if (row.kind !== 'whatsapp' || row.status !== 'linking') return rowChannel({ row, qr: null })
    const agent = await agentService.requireUse({ actor, id: row.agent_id }).catch(() => null)
    if (!agent || (agent.owner ?? actor.email) !== actor.email) return rowChannel({ row, qr: null })
    const pairing = whatsappPairing.follow({ agentId: row.agent_id, onLinked: (phone) => whatsappLinked({ id, phone, place: placeOf(agent) }) })
    if (pairing.status === 'error') throw new HttpError(502, `WhatsApp didn't connect (${pairing.error}). Close this and try again.`)
    if (pairing.status !== 'linked') return rowChannel({ row, qr: pairing.qr ?? null })
    const linked = await whatsappLinked({ id, phone: pairing.phone, place: placeOf(agent) })
    return rowChannel({ row: linked, qr: null })
  },

  async create({ actor, ...body }: CreateChannel & { actor: Caller }): Promise<Channel> {
    const facts = await owned({ actor, agentId: body.agentId })
    const name = facts.value.name
    const existing = channelsOf(await recordsService.list({ collection: 'channel', workspace: facts.workspace, parent: facts.id }))
    if (existing.some((channel) => channel.kind === body.kind)) throw new HttpError(409, `${name} already has ${LABEL[body.kind]}. Disconnect it first.`)
    const audience = audienceOfBody(body)
    const { status, account, secret } = await setupOf({ body, facts })
    const id = newId('ch')
    const held = await recordsService.put({ collection: 'channel', id, parent: facts.id, workspace: facts.workspace, personal: facts.personal, value: { kind: body.kind, status, account, ...audience, createdAt: new Date().toISOString() } satisfies ChannelRecord, secret })
    emit({ name: 'channel.created', actor, target: { type: 'channel', id, kind: body.kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    const row = await db.selectFrom('channel').selectAll().where('id', '=', id).executeTakeFirst()
    return channelOf({ held: held ?? await recordOf(id), qr: row?.kind === 'telegram' && row.status === 'linking' ? await claimLink(row) : null })
  },

  async telegramInvite({ actor, id }: { actor: Caller; id: string }): Promise<TelegramInvite> {
    const held = await recordOf(id)
    const value = ChannelRecord.parse(held.value)
    await owned({ actor, agentId: held.parent ?? '' })
    if (value.kind !== 'telegram' || value.status !== 'connected' || !value.account) throw new HttpError(409, 'Finish connecting Telegram first, then invite people.')
    return { object: 'telegram_invite', ...await telegramCodes.invite({ channelId: id, agentId: held.parent ?? '', account: value.account }) }
  },

  async telegramJoin({ agentId, code, person }: { agentId: string; code: string; person: Person }): Promise<{ object: 'telegram_join'; joined: boolean }> {
    const invite = await telegramCodes.take({ code, agentId, kind: 'invite' })
    const row = await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).where('kind', '=', 'telegram').executeTakeFirst()
    const botToken = row && TelegramSecrets.parse(JSON.parse(unseal(row.secrets))).botToken
    if (!invite || !row || !botToken || row.id !== invite.channelId) {
      if (botToken) await telegram.send({ botToken, chatId: person.chatId, text: 'That invite link expired or was already used. Ask for a new one.' }).catch(() => undefined)
      throw new HttpError(404, 'That invite link expired or was already used. Ask for a new one.')
    }
    const held = await recordOf(row.id)
    const current = ChannelRecord.parse(held.value)
    const known = current.ownerAddress === person.userId || current.allowed.includes(person.userId)
    if (!known) {
      const facts = await agentService.find({ id: agentId })
      const add = (value: ChannelRecord): ChannelRecord => ({ ...value, allowed: [...new Set([...value.allowed, person.userId])], names: { ...value.names, [person.userId]: person.name } })
      await agentService.quietly({ id: agentId, change: async () => {
        await recordsService.put({ collection: 'channel', id: row.id, parent: agentId, workspace: facts.workspace, personal: facts.personal, value: add(current), secret: held.secret, reapply: (latest) => ({ value: add(ChannelRecord.parse(latest.value)), secret: latest.secret }) })
        await runSet.apply({ workspace: facts.workspace, id: agentId }).catch((err: unknown) => log.warn({ event: 'telegram.join_apply_failed', agent: agentId, error: messageOf(err) }))
      } })
      emit({ name: 'channel.updated', target: { type: 'channel', id: row.id, kind: 'telegram', agentId } })
    }
    await telegram.send({ botToken, chatId: person.chatId, text: welcome(person.name) }).catch(() => undefined)
    return { object: 'telegram_join', joined: !known }
  },

  async telegramMember({ agentId, userId }: { agentId: string; userId: string }): Promise<boolean> {
    const row = await db.selectFrom('channel').select(['owner_address', 'open', 'allowed']).where('agent_id', '=', agentId).where('kind', '=', 'telegram').executeTakeFirst()
    if (!row) return false
    const audience = audienceOf(row)
    return audience.open || audience.ownerAddress === userId || audience.allowed.includes(userId)
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateChannel }): Promise<Channel> {
    const held = await recordOf(id)
    const current = ChannelRecord.parse(held.value)
    const facts = await owned({ actor, agentId: held.parent ?? '' })
    const wrong = patch.allowed?.find((address) => !ADDRESS[current.kind].pattern.test(address))
    if (wrong) throw new HttpError(400, `${wrong} doesn't look right. ${ADDRESS[current.kind].message}`, { param: 'allowed' })
    if (CHANNEL_KINDS.has(current.kind) && !patch.allowed) throw new HttpError(400, `A ${LABEL[current.kind]} agent answers everyone in the channels you pick. Send allowed with the channel IDs.`, { param: 'allowed' })
    if (current.kind === 'discord' && !patch.allowed?.length) throw new HttpError(400, 'Keep at least one Discord channel. Disconnect Discord to stop it answering.', { param: 'allowed' })
    const botToken = ChannelSecrets.safeParse(held.secret).data?.botToken
    const added = [...new Set(patch.allowed ?? [])].filter((address) => !current.allowed.includes(address))
    if (current.kind === 'discord' && botToken && added.length) await discord.enter({ botToken, ids: added, bot: current.account ?? 'The bot' })
    const live = current.kind === 'discord' && !!patch.allowed?.length ? { status: 'connected' as const } : {}
    const change = (value: ChannelRecord): ChannelRecord => ({ ...value, ...live, ...patch.allowed && { allowed: [...new Set(patch.allowed)] }, ...!CHANNEL_KINDS.has(current.kind) && patch.open !== undefined && { open: patch.open } })
    const saved = await recordsService.put({ collection: 'channel', id, parent: facts.id, workspace: facts.workspace, personal: facts.personal, value: change(current), secret: held.secret, reapply: (latest) => ({ value: change(ChannelRecord.parse(latest.value)), secret: latest.secret }) })
    emit({ name: 'channel.updated', actor, target: { type: 'channel', id, kind: current.kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    if (current.kind === 'discord' && botToken && added.length) {
      const failed = await discord.greet({ botToken, ids: added, bot: current.account ?? 'The bot' })
      if (failed.length) log.warn({ event: 'channel.greet_failed', agent: facts.id, failed })
    }
    return channelOf({ held: saved ?? held, qr: null })
  },

  async telegramToken({ agentId }: { agentId: string }): Promise<string> {
    const row = await db.selectFrom('channel').select('secrets').where('agent_id', '=', agentId).where('kind', '=', 'telegram').executeTakeFirst()
    if (!row) throw new HttpError(409, 'This agent has no Telegram bot. Connect one on its page first.')
    return TelegramSecrets.parse(JSON.parse(unseal(row.secrets))).botToken
  },

  async slackToken({ agentId, app = false }: { agentId: string; app?: boolean }): Promise<string> {
    const row = await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).where('kind', '=', 'slack').executeTakeFirst()
    if (!row) throw new HttpError(409, 'This agent has no Slack app. Connect one on its page first.')
    const secrets = slackSecrets(row)
    return app ? secrets.appToken : secrets.botToken
  },

  async postTargets({ agentId }: { agentId: string }): Promise<PostTarget[]> {
    const rows = await db.selectFrom('channel').selectAll().where('agent_id', '=', agentId).where('status', '=', 'connected').orderBy('created_at').orderBy('id').execute()
    const targets: PostTarget[] = []
    for (const row of rows) {
      if (row.kind === 'slack' || row.kind === 'discord') {
        const names = await namesOf(row)
        for (const chat of row.allowed.split(',').filter(Boolean)) {
          const name = names.get(chat)
          targets.push({ channel: row.id, chat, place: name ? `#${name}` : `${LABEL[row.kind]} channel ${chat}`, target: `${row.kind}:${chat}` })
        }
        continue
      }
      const chats = [...new Set([row.owner_address, ...(row.open ? [] : row.allowed.split(','))].filter(Boolean))]
      for (const chat of chats) {
        const address = row.kind === 'whatsapp' ? `${chat.replace(/\D/g, '')}@s.whatsapp.net` : chat
        targets.push({ channel: row.id, chat, place: chat === row.owner_address ? `your ${LABEL[row.kind]}` : `${LABEL[row.kind]} chat ${chat}`, target: `${row.kind}:${address}` })
      }
    }
    return targets
  },

  async postTarget({ agentId, channel, chat }: { agentId: string; channel: string; chat?: string }): Promise<PostTarget> {
    const targets = await channelService.postTargets({ agentId })
    const found = targets.find((each) => each.channel === channel && (!chat || each.chat === chat))
    if (found) return found
    if (!targets.length) throw new HttpError(400, 'You have no channels to post in. Ask your owner to add one.')
    throw new HttpError(400, `You can only post in your own channels: ${targets.map((each) => `${each.channel} ${each.chat} (${each.place})`).join(', ')}.`)
  },

  async conversations({ id }: { actor: Caller; id: string }): Promise<Conversation[]> {
    const held = await recordOf(id)
    const kind = ChannelRecord.parse(held.value).kind
    const botToken = ChannelSecrets.safeParse(held.secret).data?.botToken
    if (!botToken || (kind !== 'slack' && kind !== 'discord')) throw new HttpError(404, `Only Slack and Discord have channels to pick. This is ${LABEL[kind]}.`)
    return kind === 'slack' ? slack.conversations({ botToken }) : discord.conversations({ botToken })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'channel'>> {
    const held = await recordOf(id)
    const facts = await owned({ actor, agentId: held.parent ?? '' })
    await recordsService.remove({ collection: 'channel', workspace: facts.workspace, id })
    emit({ name: 'channel.deleted', actor, target: { type: 'channel', id, kind: ChannelRecord.parse(held.value).kind, agentId: facts.id } })
    await runSet.apply({ workspace: facts.workspace, id: facts.id })
    return deleted({ id, object: 'channel' })
  },

  async resumeTelegramClaims(): Promise<void> {
    for (const id of await telegramCodes.pending()) {
      const row = await db.selectFrom('channel').selectAll().where('id', '=', id).where('kind', '=', 'telegram').where('status', '=', 'linking').executeTakeFirst()
      if (row) await claimLink(row).catch((err: unknown) => log.warn({ event: 'telegram.claim_resume_failed', channel: id, error: messageOf(err) }))
    }
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
  const held = await recordsService.get({ collection: 'channel', workspace: HOME, id })
  if (held && !held.deleted) return held
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
      return { status: body.ownerAddress ? 'connected' : 'linking', account, secret: { botToken: body.botToken } }
    }
    case 'discord': {
      const account = await discord.verify({ botToken: body.botToken, channels: body.allowed })
      return { status: body.allowed.length ? 'connected' : 'linking', account, secret: { botToken: body.botToken } }
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
    case 'telegram':
      await telegramCodes.stop({ channelId: row.id })
      return
    case 'discord': return
  }
}

async function whatsappLinked({ id, phone, place }: { id: string; phone: string | undefined; place: { workspace: string; personal: boolean } }): Promise<Row> {
  const linked = await db.updateTable('channel').set({ status: 'connected', account: phone ? `+${phone}` : null }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
  const value: ChannelRecord = { kind: linked.kind, status: 'connected', account: linked.account, ...audienceOf(linked), createdAt: new Date(linked.created_at).toISOString() }
  await recordsService.put({ collection: 'channel', id, parent: linked.agent_id, ...place, value, queue: true, reapply: (latest) => ({ value: { ...ChannelRecord.parse(latest.value), status: 'connected', account: linked.account }, secret: latest.secret }) })
  emit({ name: 'channel.linked', target: { type: 'channel', id, kind: linked.kind, agentId: linked.agent_id } })
  return linked
}

async function claimLink(row: Row): Promise<string | null> {
  if (!row.account) return null
  const botToken = TelegramSecrets.parse(JSON.parse(unseal(row.secrets))).botToken
  return telegramCodes.claim({ channelId: row.id, agentId: row.agent_id, account: row.account, botToken, onClaim: (person) => claimed({ row, botToken, person }) })
}

async function claimed({ row, botToken, person }: { row: Row; botToken: string; person: Person }): Promise<void> {
  const facts = await agentService.find({ id: row.agent_id })
  const held = await recordOf(row.id)
  const own = (value: ChannelRecord): ChannelRecord => ({ ...value, status: 'connected', ownerAddress: person.userId, names: { ...value.names, [person.userId]: person.name } })
  await recordsService.put({ collection: 'channel', id: row.id, parent: row.agent_id, workspace: facts.workspace, personal: facts.personal, value: own(ChannelRecord.parse(held.value)), secret: held.secret, reapply: (latest) => ({ value: own(ChannelRecord.parse(latest.value)), secret: latest.secret }) })
  await db.updateTable('channel').set({ status: 'connected', owner_address: person.userId }).where('id', '=', row.id).execute()
  await telegramCodes.stop({ channelId: row.id, kind: 'claim' })
  await telegram.send({ botToken, chatId: person.chatId, text: welcome(person.name) }).catch(() => undefined)
  emit({ name: 'channel.linked', target: { type: 'channel', id: row.id, kind: 'telegram', agentId: row.agent_id } })
  await runSet.apply({ workspace: facts.workspace, id: row.agent_id }).catch((err: unknown) => log.warn({ event: 'telegram.claim_apply_failed', agent: row.agent_id, error: messageOf(err) }))
}

function audienceOfBody(body: CreateChannel): Pick<ChannelRecord, 'ownerAddress' | 'open' | 'allowed'> {
  switch (body.kind) {
    case 'slack': return { ownerAddress: '', open: false, allowed: [] }
    case 'discord': return { ownerAddress: '', open: false, allowed: [...new Set(body.allowed)] }
    default: return { ownerAddress: body.ownerAddress ?? '', open: body.open, allowed: body.allowed }
  }
}

const slackSecrets = (row: Row) => SlackSecrets.parse(JSON.parse(unseal(row.secrets)))

function channelsOf(records: Held[]): Channel[] {
  return records.flatMap((held) => ChannelRecord.safeParse(held.value).success ? [channelOf({ held, qr: null })] : []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function channelOf({ held, qr }: { held: Held; qr: string | null }): Channel {
  const value = ChannelRecord.parse(held.value)
  const botToken = value.kind === 'discord' ? ChannelSecrets.safeParse(held.secret).data?.botToken : undefined
  return { id: held.id, object: 'channel', agentId: held.parent ?? '', kind: value.kind, status: value.status, account: value.account, ownerAddress: value.ownerAddress, open: value.open, allowed: value.allowed, names: value.names, qr, ...botToken && { link: discord.invite(botToken) }, createdAt: value.createdAt }
}

function rowChannel({ row, qr }: { row: Row; qr: string | null }): Channel {
  return { id: row.id, object: 'channel', agentId: row.agent_id, kind: row.kind, status: row.status, account: row.account, ...audienceOf(row), qr, createdAt: new Date(row.created_at).toISOString() }
}

type Row = Selectable<Database['channel']>
export type PostTarget = { channel: string; chat: string; place: string; target: string }

async function namesOf(row: Row): Promise<Map<string, string>> {
  try {
    const botToken = ChannelSecrets.parse(JSON.parse(unseal(row.secrets))).botToken ?? ''
    const found = row.kind === 'slack' ? await slack.conversations({ botToken }) : await discord.conversations({ botToken })
    return new Map(found.map((each) => [each.id, each.name.replace(/^#/, '')]))
  } catch {
    return new Map()
  }
}
