import type { Selectable } from 'kysely'
import * as z from 'zod/mini'
import { UpdateAgentFields } from '@openhut/common/agents/agent.ts'
import type { ChangeAction, ChangeRequest } from '@openhut/common/agents/change-request.ts'
import { CreateChannel } from '@openhut/common/channels/channel.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId } from '../platform/secrets.ts'
import { describeIssues } from '../platform/validation.ts'
import type { Caller } from '../team/identity.ts'
import { activity } from '../gateway/activity.ts'
import { channelService } from '../channels/channel-service.ts'
import { Origin } from '../routines/routine-service.ts'
import { agentService } from './agent-service.ts'

const DASHBOARD = 'api_server'
const QUIET_MS = 10_000
const RETRY_MS = 30_000
const RETRIES = 20
const delivering = new Set<string>()
const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord' } as const
const SelfChange = z.object({ name: UpdateAgentFields.name, instructions: UpdateAgentFields.instructions })
const ChannelChange = z.object({ id: z.string().check(z.maxLength(40)), open: z.optional(z.boolean()), allowed: z.optional(z.array(z.string().check(z.maxLength(20))).check(z.maxLength(50))) })
const ChannelId = z.object({ id: z.string().check(z.maxLength(40)) })
const ConnectionId = z.object({ connectionId: z.string().check(z.maxLength(40)) })

type Row = Selectable<Database['change_request']>
type Runner = (input: { agentId: string; text: string }) => Promise<string>
let dashboardRunner: Runner = async () => { throw new Error('No dashboard runner.') }

export const changeRequestService = {
  async ask({ agentId, action, input, why, origin }: { agentId: string; action: ChangeAction; input: unknown; why: string; origin: unknown }): Promise<string> {
    const from = z.safeParse(Origin, origin)
    if (!from.success) throw new HttpError(400, 'You can only ask for a change from a chat you\'re in.')
    const checked = checkedInput({ action, input, agentId })
    const summary = await summaryOf({ action, input: checked, agentId })
    const row = await db.insertInto('change_request').values({ id: newId('chg'), agent_id: agentId, action, input: JSON.stringify(checked), summary, why, origin: JSON.stringify(from.data) })
      .returningAll().executeTakeFirstOrThrow()
    emit({ name: 'change_request.created', target: { type: 'change_request', id: row.id, agentId, action } })
    return `Asked for approval (${row.id}): ${summary}. Nothing has changed yet. Tell the person in one line that it waits for your owner's approval in OpenHut, then stop. The answer comes back to you as a message.`
  },

  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<ChangeRequest[]> {
    await agentService.get({ actor, id: agentId })
    const rows = await db.selectFrom('change_request').selectAll().where('agent_id', '=', agentId).orderBy('created_at', 'desc').limit(50).execute()
    return rows.map(requestOf)
  },

  async inChat({ agentId, since }: { agentId: string; since: Date }): Promise<string[]> {
    const rows = await db.selectFrom('change_request').select(['id', 'origin']).where('agent_id', '=', agentId).where('created_at', '>=', since).orderBy('created_at').execute()
    return rows.filter(inApp).map((row) => row.id)
  },

  async approve({ actor, id, input }: { actor: Caller; id: string; input?: Record<string, unknown> }): Promise<ChangeRequest> {
    const row = await pendingRow({ actor, id })
    const final = input ? checkedInput({ action: action(row), input, agentId: row.agent_id }) : JSON.parse(row.input) as Record<string, unknown>
    agentService.holdReapply(row.agent_id)
    try {
      await apply({ actor, row, input: final })
    } catch (err) {
      await agentService.releaseReapply(row.agent_id)
      throw err
    }
    const summary = input ? await summaryOf({ action: action(row), input: final, agentId: row.agent_id }) : row.summary
    const decided = await decide({ id, status: 'approved', input: final, summary, note: null })
    deliver(decided)
    void activity.quiet({ agentId: row.agent_id, ms: QUIET_MS }).then(() => agentService.releaseReapply(row.agent_id))
      .catch((err: unknown) => log.warn({ event: 'change_request.reapply_failed', agent: row.agent_id, error: messageOf(err) }))
    emit({ name: 'change_request.approved', actor, target: { type: 'change_request', id, agentId: row.agent_id, action: row.action } })
    return requestOf(decided)
  },

  async deny({ actor, id, note }: { actor: Caller; id: string; note?: string }): Promise<ChangeRequest> {
    const row = await pendingRow({ actor, id })
    const decided = await decide({ id, status: 'denied', input: JSON.parse(row.input), summary: row.summary, note: note?.trim() || null })
    deliver(decided)
    emit({ name: 'change_request.denied', actor, target: { type: 'change_request', id, agentId: row.agent_id, action: row.action } })
    return requestOf(decided)
  },

  async due({ agentId }: { agentId: string }): Promise<{ runId: string; text: string; origin: Origin }[]> {
    const rows = await db.selectFrom('change_request').selectAll().where('agent_id', '=', agentId).where('status', '<>', 'pending').where('told', '=', false).execute()
    return rows.filter((row) => !inApp(row)).map((row) => ({ runId: row.id, text: decisionText(row), origin: originOf(row) }))
  },

  async picked({ agentId, id }: { agentId: string; id: string }): Promise<void> {
    const done = await db.updateTable('change_request').set({ told: true }).where('agent_id', '=', agentId).where('id', '=', id).where('status', '<>', 'pending').returning('id').executeTakeFirst()
    if (!done) throw new HttpError(404, `No decided request ${id}.`)
  },

  async resume(): Promise<void> {
    const rows = await db.selectFrom('change_request').selectAll().where('status', '<>', 'pending').where('told', '=', false).execute()
    for (const row of rows) deliver(row)
  },

  runDashboardWith(runner: Runner): void {
    dashboardRunner = runner
  },
}

function checkedInput({ action, input, agentId }: { action: ChangeAction; input: unknown; agentId: string }): Record<string, unknown> {
  const parsed = parsedInput({ action, input, agentId })
  if (!parsed.success) throw new HttpError(400, `That change isn't valid. ${describeIssues(parsed.error.issues)}`)
  const { agentId: _agentId, ...rest } = parsed.data as Record<string, unknown>
  if (action === 'update_self' && rest.name === undefined && rest.instructions === undefined) throw new HttpError(400, 'Send a new name, new instructions, or both.')
  if (action === 'update_channel' && rest.open === undefined && rest.allowed === undefined) throw new HttpError(400, 'Send open, allowed, or both.')
  if (action === 'add_channel' && rest.kind === 'slack') throw new HttpError(400, 'Slack needs a Slack app of its own. Ask your owner to add it from your page in OpenHut.')
  return rest
}

function parsedInput({ action, input, agentId }: { action: ChangeAction; input: unknown; agentId: string }) {
  switch (action) {
    case 'update_self': return z.safeParse(SelfChange, input)
    case 'add_channel': return z.safeParse(CreateChannel, { ...(typeof input === 'object' ? input : {}), agentId })
    case 'update_channel': return z.safeParse(ChannelChange, input)
    case 'remove_channel': return z.safeParse(ChannelId, input)
    case 'request_connection': return z.safeParse(ConnectionId, input)
  }
}

async function summaryOf({ action, input, agentId }: { action: ChangeAction; input: Record<string, unknown>; agentId: string }): Promise<string> {
  switch (action) {
    case 'update_self': return [input.name !== undefined && `Rename to ${String(input.name)}`, input.instructions !== undefined && 'Change its instructions'].filter(Boolean).join(' and ')
    case 'add_channel': {
      const kind = input.kind as keyof typeof LABEL
      if (await db.selectFrom('channel').select('id').where('agent_id', '=', agentId).where('kind', '=', kind).executeTakeFirst()) throw new HttpError(409, `You already have ${LABEL[kind]}. Ask your owner to remove it in OpenHut first, or ask to change it with update_channel.`)
      return `Add ${LABEL[kind]}${input.open ? ', open to anyone' : ''}`
    }
    case 'update_channel': return `Change who can message it on ${LABEL[(await ownChannel({ agentId, id: String(input.id) })).kind]}`
    case 'remove_channel': return `Remove ${LABEL[(await ownChannel({ agentId, id: String(input.id) })).kind]}`
    case 'request_connection': {
      const connection = await db.selectFrom('connection').select(['name', 'kind']).where('id', '=', String(input.connectionId)).executeTakeFirst()
      if (!connection) throw new HttpError(404, `There's no connection ${String(input.connectionId)}. Call get_self to see the ones you can ask for.`)
      return `Use ${connection.name}`
    }
  }
}

async function apply({ actor, row, input }: { actor: Caller; row: Row; input: unknown }): Promise<void> {
  const agentId = row.agent_id
  const fields = input as Record<string, unknown>
  switch (action(row)) {
    case 'update_self': return void await agentService.update({ actor, id: agentId, patch: z.parse(SelfChange, input) })
    case 'add_channel': return void await channelService.create({ actor, ...z.parse(CreateChannel, { ...fields, agentId }) }).catch(alreadyDone(409))
    case 'update_channel': {
      const { id, ...patch } = z.parse(ChannelChange, input)
      await ownChannel({ agentId, id })
      return void await channelService.update({ actor, id, patch })
    }
    case 'remove_channel': {
      const { id } = z.parse(ChannelId, input)
      return void await ownChannel({ agentId, id }).then(() => channelService.delete({ actor, id })).catch(alreadyDone(404))
    }
    case 'request_connection': return void await agentService.createGrant({ actor, agentId, connectionId: z.parse(ConnectionId, input).connectionId })
  }
}

function alreadyDone(status: number) {
  return (err: unknown) => {
    if (!(err instanceof HttpError) || err.status !== status) throw err
  }
}

function afterApproval({ row, input }: { row: Row; input: unknown }): string {
  const fields = input as Record<string, unknown>
  if (action(row) === 'add_channel' && fields.kind === 'whatsapp') return ' WhatsApp links once your owner scans the QR code on your page in OpenHut.'
  if (action(row) !== 'update_self' || fields.instructions !== undefined) return ' You restart to pick it up right after this reply.'
  return ''
}

async function ownChannel({ agentId, id }: { agentId: string; id: string }): Promise<{ kind: keyof typeof LABEL }> {
  const channel = await db.selectFrom('channel').select('kind').where('id', '=', id).where('agent_id', '=', agentId).executeTakeFirst()
  if (!channel) throw new HttpError(404, `You have no channel ${id}. Call get_self to see yours.`)
  return channel
}

async function pendingRow({ actor, id }: { actor: Caller; id: string }): Promise<Row> {
  const row = await db.selectFrom('change_request').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(404, 'That request doesn\'t exist.')
  await agentService.requireEditable({ actor, id: row.agent_id })
  if (row.status !== 'pending') throw new HttpError(409, `That request was already ${row.status}.`)
  return row
}

async function decide({ id, status, input, summary, note }: { id: string; status: 'approved' | 'denied'; input: unknown; summary: string; note: string | null }): Promise<Row> {
  return db.updateTable('change_request').set({ status, input: JSON.stringify(input), summary, note, decided_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
}

function deliver(row: Row, attempt = 0): void {
  if (!inApp(row) || delivering.has(row.id)) return
  delivering.add(row.id)
  void dashboardRunner({ agentId: row.agent_id, text: decisionText(row) })
    .then(() => db.updateTable('change_request').set({ told: true }).where('id', '=', row.id).execute())
    .then(() => { delivering.delete(row.id) }, (err: unknown) => {
      delivering.delete(row.id)
      log.warn({ event: 'change_request.deliver_failed', id: row.id, attempt, error: messageOf(err) })
      if (attempt < RETRIES) setTimeout(() => deliver(row, attempt + 1), RETRY_MS).unref()
    })
}

function decisionText(row: Row): string {
  if (row.status === 'denied') return `[OpenHut ${row.id}] Not approved: ${row.summary}.${row.note ? ` They said: "${row.note}"` : ''} Nothing changed. Tell the chat in one line, and don't ask again unless they bring it up.`
  return `[OpenHut ${row.id}] Approved and done: ${row.summary}.${afterApproval({ row, input: JSON.parse(row.input) })} Tell the chat in one line, with the final values if they differ from what you asked for.`
}

function inApp(row: Pick<Row, 'origin'>): boolean {
  return originOf(row).platform === DASHBOARD
}

function originOf(row: Pick<Row, 'origin'>): Origin {
  return JSON.parse(row.origin) as Origin
}

function action(row: Row): ChangeAction {
  return row.action as ChangeAction
}

function requestOf(row: Row): ChangeRequest {
  return {
    id: row.id, object: 'change_request', agentId: row.agent_id, action: action(row), input: JSON.parse(row.input) as Record<string, unknown>, summary: row.summary, why: row.why,
    status: row.status, note: row.note, createdAt: row.created_at.toISOString(), decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
  }
}
