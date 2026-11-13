import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import * as z from 'zod/mini'
import type { Agent, AgentHealth, AgentStatus, Grant, UpdateAgent } from '@fastmonkey/common/agents/agent.ts'
import type { Deleted } from '@fastmonkey/common/api.ts'
import { db, findRow, isUniqueViolation } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentToken, newId, sameSecret, seal, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { agentd, containerStates, type AgentFiles } from '../platform/agentd.ts'
import { agentApiUrl, agentSubnet } from '../platform/network.ts'
import { log, record } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { connectionService } from '../connections/connection-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'
import { audienceOf } from '../channels/audience.ts'
import { renderFiles, type RenderedChannel } from './hermes-files.ts'

const MAX_AGENTS = 250
const RECONCILE_MS = 30_000
const PROBE_MS = 3_000
const PROBE_FRESH_MS = 5_000
const STARTING_MS = 180_000
const RENDERED = ['instructions', 'model', 'codeExecution'] as const
const SlackSecrets = z.object({ botToken: z.string(), appToken: z.string() })
const TelegramSecrets = z.object({ botToken: z.string() })

export const agentService = {
  async list({ actor }: { actor: Caller }): Promise<Agent[]> {
    const [rows, states] = await Promise.all([db.selectFrom('agent').selectAll().orderBy('created_at').execute(), containerStates()])
    const owners = new Map((await db.selectFrom('person').select(['id', 'email']).execute()).map((person) => [person.id, person.email]))
    return Promise.all(rows.map(async (row) => agentOf({ row, ownerName: owners.get(row.owner_id), state: states?.[row.id], health: await healthOf({ row, state: states?.[row.id] }), editable: await canEdit({ actor, agent: row }) })))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    const row = await rowOf(id)
    const owner = await db.selectFrom('person').select('email').where('id', '=', row.owner_id).executeTakeFirst()
    const state = (await containerStates())?.[id]
    return agentOf({ row, ownerName: owner?.email, state, health: await healthOf({ row, state }), editable: await canEdit({ actor, agent: row }) })
  },

  async requireEditable({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
    const row = await rowOf(id)
    if (!(await canEdit({ actor, agent: row }))) throw new HttpError(403, `Only ${row.name}'s owner, or an admin who can use all its connections, can change it.`)
    return row
  },

  async create({ actor, name, instructions }: { actor: Caller; name: string; instructions?: string }): Promise<Agent> {
    const clean = cleanName(name)
    const used = new Set((await db.selectFrom('agent').select('net').execute()).map((row) => row.net))
    const net = Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).find((n) => !used.has(n))
    if (!net) throw new HttpError(409, `This server already runs ${MAX_AGENTS} agents. Delete one first.`)
    const row = await db.insertInto('agent').values({
      id: newId('ag'), name: clean, owner_id: actor.id, model: 'sonnet', net, channel_key: seal(randomBytes(24).toString('hex')),
      instructions: (instructions || `# ${clean}\n\nYou are ${clean}. Answer briefly.`).slice(0, 20_000),
    }).returningAll().executeTakeFirstOrThrow().catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(409, 'Someone created an agent at the same moment. Try again.') : err })
    try {
      await agentd.create({ id: row.id, net, files: await filesOf(row) })
    } catch (err) {
      await agentd.remove({ id: row.id }).catch(() => undefined)
      await db.deleteFrom('agent').where('id', '=', row.id).execute()
      throw err
    }
    record({ action: 'agent.created', actor, target: { type: 'agent', id: row.id, name: row.name } })
    return agentService.get({ actor, id: row.id })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
    await agentService.requireEditable({ actor, id })
    const { codeExecution, ...fields } = patch
    await db.updateTable('agent').set({ ...fields, code_execution: codeExecution, name: patch.name === undefined ? undefined : cleanName(patch.name) }).where('id', '=', id).execute()
    if (RENDERED.some((field) => patch[field] !== undefined)) await agentService.reapply({ id })
    if (patch.wanted) await (patch.wanted === 'running' ? agentd.start({ id }) : agentd.stop({ id }))
    return agentService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'agent'>> {
    const row = await rowOf(id)
    if (row.owner_id !== actor.id && !isAdmin(actor)) throw new HttpError(403, `Only ${row.name}'s owner or an admin can delete it.`)
    await agentd.remove({ id })
    await db.deleteFrom('agent').where('id', '=', id).execute()
    record({ action: 'agent.deleted', actor, target: { type: 'agent', id, name: row.name } })
    return deleted({ id, object: 'agent' })
  },

  async reapply({ id }: { id: string }): Promise<void> {
    const row = await rowOf(id)
    await agentd.apply({ id, net: row.net, files: await filesOf(row), restart: row.wanted === 'running' })
  },

  async stopOwnedBy({ ownerId }: { ownerId: string }): Promise<void> {
    const stopped = await db.updateTable('agent').set({ wanted: 'stopped' }).where('owner_id', '=', ownerId).returning('id').execute()
    for (const { id } of stopped) await agentd.stop({ id }).catch((err: unknown) => log.warn({ event: 'agent.stop_failed', agent: id, error: messageOf(err) }))
  },

  async byToken({ token, address }: { token: string; address: string }): Promise<GatewayAgent | undefined> {
    const row = await db.selectFrom('agent').select(['id', 'owner_id', 'net']).where('id', '=', token.split('.')[0]).executeTakeFirst()
    if (!row || !sameSecret({ given: token, expected: agentToken(row.id) })) return undefined
    return address.startsWith(`${agentSubnet(row.net)}.`) ? row : undefined
  },

  async listGrants({ agentId, connectionId }: { agentId?: string; connectionId?: string }): Promise<Grant[]> {
    let select = db.selectFrom('connection_grant').selectAll().orderBy('created_at')
    if (agentId) select = select.where('agent_id', '=', agentId)
    if (connectionId) select = select.where('connection_id', '=', connectionId)
    return (await select.execute()).map(grantOf)
  },

  async createGrant({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<Grant> {
    await agentService.requireEditable({ actor, id: agentId })
    const connection = await connectionService.get({ actor, id: connectionId })
    if (!connection.usable) throw new HttpError(403, `You can grant only a connection you can use. ${connection.ownerName} hasn't shared ${connection.name}.`)
    await db.insertInto('connection_grant').values({ id: newId('gr'), agent_id: agentId, connection_id: connectionId })
      .onConflict((oc) => oc.columns(['connection_id', 'agent_id']).doNothing()).execute()
    const grant = await db.selectFrom('connection_grant').selectAll().where('agent_id', '=', agentId).where('connection_id', '=', connectionId).executeTakeFirstOrThrow()
    record({ action: 'grant.created', actor, target: { type: 'grant', id: grant.id, agentId, connectionId } })
    return grantOf(grant)
  },

  async deleteGrant({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'grant'>> {
    const grant = await findRow({ table: 'connection_grant', id, missing: 'That grant doesn\'t exist. It may have been removed already.' })
    await agentService.requireEditable({ actor, id: grant.agent_id })
    await db.deleteFrom('connection_grant').where('id', '=', id).execute()
    record({ action: 'grant.deleted', actor, target: { type: 'grant', id, agentId: grant.agent_id, connectionId: grant.connection_id } })
    return deleted({ id, object: 'grant' })
  },

  async reapplyAll({ force }: { force: boolean }): Promise<string[]> {
    const failed: string[] = []
    for (const row of await db.selectFrom('agent').selectAll().execute()) {
      await agentd.apply({ id: row.id, net: row.net, files: await filesOf(row), restart: row.wanted === 'running', force })
        .catch((err: unknown) => failed.push(`${row.name}: ${messageOf(err)}`))
    }
    return failed
  },

  async boot(): Promise<void> {
    await applyRelease().catch((err: unknown) => log.error({ event: 'build.apply_failed', error: messageOf(err) }))
    await reconcileSafely()
    setInterval(() => void reconcileSafely(), RECONCILE_MS)
  },
}

const reconcileSafely = () => reconcile().catch((err: unknown) => log.error({ event: 'reconcile.failed', error: messageOf(err) }))

async function reconcile(): Promise<void> {
  const states = await containerStates()
  if (!states) return
  for (const row of await db.selectFrom('agent').selectAll().where('wanted', '=', 'running').execute()) {
    if (states[row.id] === 'running') await probe({ row, fresh: true })
    await keepRunning({ row, state: states[row.id] }).catch((err: unknown) => log.error({ event: 'reconcile.failed', agent: row.id, error: messageOf(err) }))
  }
}

const rowOf = (id: string): Promise<AgentRow> => findRow({ table: 'agent', id, missing: 'That agent doesn\'t exist. It may have been deleted.' })

async function canEdit({ actor, agent }: { actor: Caller; agent: AgentRow }): Promise<boolean> {
  if (agent.owner_id === actor.id) return true
  if (!isAdmin(actor)) return false
  for (const connection of await connectionService.reachable({ agent })) {
    if (!(await connectionService.canUse({ personId: actor.id, connectionId: connection.id }))) return false
  }
  return true
}

async function filesOf(row: AgentRow): Promise<AgentFiles> {
  const owner = await db.selectFrom('person').select('email').where('id', '=', row.owner_id).executeTakeFirstOrThrow()
  const channels = await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).orderBy('kind').execute()
  return renderFiles({
    agent: row, ownerName: owner.email, token: agentToken(row.id), channelKey: unseal(row.channel_key),
    seat: settings.seatToken(), channels: channels.map(renderedChannel),
  })
}

function renderedChannel(channel: Selectable<Database['channel']>): RenderedChannel {
  const audience = audienceOf(channel)
  switch (channel.kind) {
    case 'whatsapp': return { kind: 'whatsapp', audience }
    case 'slack': return { kind: 'slack', audience, ...SlackSecrets.parse(JSON.parse(unseal(channel.secrets))) }
    case 'telegram': return { kind: 'telegram', audience, ...TelegramSecrets.parse(JSON.parse(unseal(channel.secrets))) }
  }
}

async function keepRunning({ row, state }: { row: AgentRow; state: string | undefined }): Promise<void> {
  if (state === undefined) {
    await agentd.create({ id: row.id, net: row.net, files: await filesOf(row) })
    await agentd.start({ id: row.id })
    log.info({ event: 'reconcile.recreated', agent: row.id })
    return
  }
  if (state !== 'running') {
    await agentd.start({ id: row.id })
    log.info({ event: 'reconcile.started', agent: row.id })
    return
  }
  const { restarted } = await agentd.apply({ id: row.id, net: row.net, files: await filesOf(row), restart: true })
  if (restarted) log.info({ event: 'reconcile.restarted', agent: row.id })
}

async function applyRelease(): Promise<void> {
  const previous = settings.appliedBuild()
  const force = previous !== undefined && previous !== config.build
  const failed = await agentService.reapplyAll({ force })
  if (failed.length) {
    log.error({ event: 'build.apply_failed', error: failed.join('; ') })
    return
  }
  await settings.setAppliedBuild(config.build)
  if (force) log.info({ event: 'build.applied', from: previous, to: config.build })
}

function agentOf({ row, ownerName, state, health, editable }: { row: AgentRow; ownerName: string | undefined; state: string | undefined; health: Health; editable: boolean }): Agent {
  return {
    id: row.id, object: 'agent', name: row.name, ownerId: row.owner_id, ownerName: ownerName ?? 'someone', model: row.model, wanted: row.wanted,
    status: statusOf(state), health: health.health, healthDetail: health.detail, summary: summaryOf(row.instructions), net: row.net, instructions: row.instructions, codeExecution: row.code_execution, canEdit: editable, createdAt: new Date(row.created_at).toISOString(),
  }
}

function statusOf(state: string | undefined): AgentStatus {
  switch (state) {
    case 'running': return 'running'
    case 'exited':
    case 'created': return 'stopped'
    default: return 'missing'
  }
}

const probes = new Map<string, Probe>()

async function healthOf({ row, state }: { row: AgentRow; state: string | undefined }): Promise<Health> {
  if (state !== 'running') {
    probes.delete(row.id)
    return { health: null, detail: '' }
  }
  const last = await probe({ row, fresh: false })
  if (!last.detail && config.modelMode === 'claude' && !settings.seatToken()) return { health: 'no_seat', detail: 'No Claude seat is connected, so its model can\'t answer. An owner or admin connects one in Admin.' }
  if (!last.detail) return { health: 'answering', detail: '' }
  return { health: Date.now() - last.failingSince > STARTING_MS ? 'not_answering' : 'starting', detail: last.detail }
}

async function probe({ row, fresh }: { row: AgentRow; fresh: boolean }): Promise<Probe> {
  const last = probes.get(row.id)
  if (last && !fresh && Date.now() - last.at < PROBE_FRESH_MS) return last
  const detail = await fetch(`${agentApiUrl(row.net)}/v1/models`, { headers: { authorization: `Bearer ${unseal(row.channel_key)}` }, signal: AbortSignal.timeout(PROBE_MS) })
    .then((res) => res.ok ? '' : `Hermes answered ${res.status}.`)
    .catch((err: unknown) => unreachable(err))
  const next = { at: Date.now(), detail, failingSince: detail && last?.detail ? last.failingSince : Date.now() }
  probes.set(row.id, next)
  return next
}

export function unreachable(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return `Hermes didn't answer within ${PROBE_MS / 1000} seconds.`
  const code = err instanceof Error && typeof err.cause === 'object' && err.cause !== null && 'code' in err.cause ? String(err.cause.code) : messageOf(err)
  return `Hermes isn't answering on port 8642 (${code}).`
}

type Probe = { at: number; detail: string; failingSince: number }
type Health = { health: AgentHealth | null; detail: string }

const summaryOf = (instructions: string): string => instructions.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? ''

function grantOf(row: Selectable<Database['connection_grant']>): Grant {
  return { id: row.id, object: 'grant', agentId: row.agent_id, connectionId: row.connection_id, createdAt: new Date(row.created_at).toISOString() }
}

type AgentRow = Selectable<Database['agent']>
export type GatewayAgent = { id: string; owner_id: string; net: number }

function cleanName(name: string): string {
  const clean = name.trim().replace(/[^\w .-]/g, '').slice(0, 40)
  if (!clean) throw new HttpError(400, 'Give the agent a name with letters or digits.', { param: 'name' })
  return clean
}
