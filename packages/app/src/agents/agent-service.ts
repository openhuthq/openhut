import { randomBytes } from 'node:crypto'
import type { Agent, AgentStatus, Grant, UpdateAgent } from '@jakebox/common/agents/agent.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentToken, newId, sameSecret, seal, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { agentd, containerStates, type AgentFiles } from '../platform/agentd.ts'
import { agentSubnet } from '../platform/network.ts'
import { log } from '../platform/events.ts'
import { connectionService } from '../connections/connection-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'
import { renderFiles, type RenderedChannel } from './hermes-files.ts'

const MAX_AGENTS = 250
const RECONCILE_MS = 30_000

export const agentService = {
  async list({ actor }: { actor: Caller }): Promise<Agent[]> {
    const [rows, states] = await Promise.all([db.selectFrom('agent').selectAll().orderBy('created_at').execute(), containerStates()])
    const owners = new Map((await db.selectFrom('person').select(['id', 'username']).execute()).map((person) => [person.id, person.username]))
    return Promise.all(rows.map(async (row) => agentOf({ row, ownerName: owners.get(row.owner_id), state: states?.[row.id], canEdit: await canEdit({ actor, agent: row }) })))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    const row = await rowOf(id)
    const owner = await db.selectFrom('person').select('username').where('id', '=', row.owner_id).executeTakeFirst()
    return agentOf({ row, ownerName: owner?.username, state: (await containerStates())?.[id], canEdit: await canEdit({ actor, agent: row }) })
  },

  async editable({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
    const row = await rowOf(id)
    if (!(await canEdit({ actor, agent: row }))) throw new HttpError(403, `Only ${row.name}'s owner, or an admin who can use all its connections, can change it.`)
    return row
  },

  async create({ actor, name, instructions }: { actor: Caller; name: string; instructions?: string }): Promise<Agent> {
    const clean = name.trim().replace(/[^\w .-]/g, '').slice(0, 40)
    if (!clean) throw new HttpError(400, 'Give the agent a name with letters or digits.', { param: 'name' })
    const used = new Set((await db.selectFrom('agent').select('net').execute()).map((row) => row.net))
    const net = Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).find((n) => !used.has(n))
    if (!net) throw new HttpError(409, `This server already runs ${MAX_AGENTS} agents. Delete one first.`)
    const row = await db.insertInto('agent').values({
      id: newId('ag'), name: clean, owner_id: actor.id, model: 'sonnet', net, channel_key: seal(randomBytes(24).toString('hex')),
      instructions: (instructions || `# ${clean}\n\nYou are ${clean}. Answer briefly.`).slice(0, 20_000),
    }).returningAll().executeTakeFirstOrThrow()
    try {
      await agentd({ cmd: 'create', id: row.id, net, files: await filesOf(row) })
    } catch (err) {
      await agentd({ cmd: 'rm', id: row.id }).catch(() => undefined)
      await db.deleteFrom('agent').where('id', '=', row.id).execute()
      throw err
    }
    return agentService.get({ actor, id: row.id })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
    await agentService.editable({ actor, id })
    const changes: Partial<Pick<AgentRow, 'instructions' | 'model' | 'wanted'>> = {}
    if (patch.instructions !== undefined) changes.instructions = patch.instructions
    if (patch.model) changes.model = patch.model
    if (patch.wanted) changes.wanted = patch.wanted
    if (!Object.keys(changes).length) throw new HttpError(400, 'Send at least one field to change.')
    await db.updateTable('agent').set(changes).where('id', '=', id).execute()
    if (patch.instructions !== undefined || patch.model) await agentService.reapply({ id })
    if (patch.wanted) await agentd({ cmd: patch.wanted === 'running' ? 'start' : 'stop', id })
    return agentService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    const row = await rowOf(id)
    if (row.owner_id !== actor.id && !isAdmin(actor)) throw new HttpError(403, `Only ${row.name}'s owner or an admin can delete it.`)
    await agentd({ cmd: 'rm', id })
    await db.deleteFrom('agent').where('id', '=', id).execute()
  },

  async reapply({ id }: { id: string }): Promise<void> {
    const row = await rowOf(id)
    await agentd({ cmd: 'apply', id, files: await filesOf(row), restart: row.wanted === 'running' })
  },

  async stopOwnedBy({ ownerId }: { ownerId: string }): Promise<void> {
    const stopped = await db.updateTable('agent').set({ wanted: 'stopped' }).where('owner_id', '=', ownerId).returning('id').execute()
    for (const { id } of stopped) await agentd({ cmd: 'stop', id }).catch((err: Error) => log.warn({ event: 'agent.stop_failed', agent: id, error: err.message }))
  },

  async byToken({ token, address }: { token: string; address: string }): Promise<GatewayAgent | undefined> {
    const row = await db.selectFrom('agent').select(['id', 'owner_id', 'net', 'token_version']).where('id', '=', token.split('.')[0]).executeTakeFirst()
    if (!row || !sameSecret({ given: token, expected: agentToken({ agentId: row.id, version: row.token_version }) })) return undefined
    return address.startsWith(`${agentSubnet(row.net)}.`) ? row : undefined
  },

  async listGrants({ agentId, connectionId }: { agentId?: string; connectionId?: string }): Promise<Grant[]> {
    let select = db.selectFrom('connection_grant').selectAll().orderBy('created_at')
    if (agentId) select = select.where('agent_id', '=', agentId)
    if (connectionId) select = select.where('connection_id', '=', connectionId)
    return (await select.execute()).map(grantOf)
  },

  async createGrant({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<Grant> {
    await agentService.editable({ actor, id: agentId })
    const connection = await connectionService.get({ actor, id: connectionId })
    if (!connection.usable) throw new HttpError(403, `You can grant only a connection you can use. ${connection.ownerName} hasn't shared ${connection.name}.`)
    await db.insertInto('connection_grant').values({ id: newId('gr'), agent_id: agentId, connection_id: connectionId })
      .onConflict((oc) => oc.columns(['connection_id', 'agent_id']).doNothing()).execute()
    return grantOf(await db.selectFrom('connection_grant').selectAll().where('agent_id', '=', agentId).where('connection_id', '=', connectionId).executeTakeFirstOrThrow())
  },

  async deleteGrant({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    const grant = await db.selectFrom('connection_grant').selectAll().where('id', '=', id).executeTakeFirst()
    if (!grant) throw new HttpError(404, 'That grant doesn\'t exist. It may have been removed already.')
    await agentService.editable({ actor, id: grant.agent_id })
    await db.deleteFrom('connection_grant').where('id', '=', id).execute()
  },

  async reapplyAll({ force }: { force: boolean }): Promise<string[]> {
    const failed: string[] = []
    for (const row of await db.selectFrom('agent').selectAll().execute()) {
      await agentd({ cmd: 'apply', id: row.id, files: await filesOf(row), restart: row.wanted === 'running', force })
        .catch((err: Error) => failed.push(`${row.name}: ${err.message}`))
    }
    return failed
  },

  async reconcile(): Promise<void> {
    const states = await containerStates()
    if (!states) return
    for (const row of await db.selectFrom('agent').selectAll().where('wanted', '=', 'running').execute()) {
      await keepRunning({ row, state: states[row.id] }).catch((err: Error) => log.error({ event: 'reconcile.failed', agent: row.id, error: err.message }))
    }
  },

  async boot(): Promise<void> {
    await applyRelease().catch((err: Error) => log.error({ event: 'build.apply_failed', error: err.message }))
    await reconcileSafely()
    setInterval(() => void reconcileSafely(), RECONCILE_MS)
  },
}

const reconcileSafely = () => agentService.reconcile().catch((err: Error) => log.error({ event: 'reconcile.failed', error: err.message }))

async function rowOf(id: string): Promise<AgentRow> {
  const row = /^ag_[a-z0-9]{8}$/.test(id) ? await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst() : undefined
  if (!row) throw new HttpError(404, 'That agent doesn\'t exist. It may have been deleted.')
  return row
}

async function canEdit({ actor, agent }: { actor: Caller; agent: AgentRow }): Promise<boolean> {
  if (agent.owner_id === actor.id) return true
  if (!isAdmin(actor)) return false
  for (const connection of await connectionService.reachable({ agent })) {
    if (!(await connectionService.canUse({ personId: actor.id, connectionId: connection.id }))) return false
  }
  return true
}

async function filesOf(row: AgentRow): Promise<AgentFiles> {
  const owner = await db.selectFrom('person').select('username').where('id', '=', row.owner_id).executeTakeFirstOrThrow()
  const channels = await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).orderBy('kind').execute()
  return renderFiles({
    agent: row, ownerName: owner.username, token: agentToken({ agentId: row.id, version: row.token_version }), channelKey: unseal(row.channel_key),
    seat: settings.seatToken(), channels: channels.map(renderedChannel),
  })
}

function renderedChannel(channel: { kind: 'slack' | 'whatsapp'; owner_address: string; open: boolean; allowed: string; secrets: string }): RenderedChannel {
  const audience = { ownerAddress: channel.owner_address, open: channel.open, allowed: channel.allowed ? channel.allowed.split(',') : [] }
  if (channel.kind === 'whatsapp') return { kind: 'whatsapp', audience }
  const tokens: { botToken: string; appToken: string } = JSON.parse(unseal(channel.secrets))
  return { kind: 'slack', audience, ...tokens }
}

async function keepRunning({ row, state }: { row: AgentRow; state: string | undefined }): Promise<void> {
  if (state !== 'running') {
    await agentd({ cmd: 'start', id: row.id })
    log.info({ event: 'reconcile.started', agent: row.id, message: `reconcile: started ${row.id}` })
    return
  }
  const { restarted } = await agentd({ cmd: 'apply', id: row.id, files: await filesOf(row), restart: true })
  if (restarted) log.info({ event: 'reconcile.restarted', agent: row.id, message: `reconcile: restarted ${row.id} on newer files` })
}

async function applyRelease(): Promise<void> {
  const previous = settings.appliedBuild()
  const force = previous !== undefined && previous !== config.build
  const failed = await agentService.reapplyAll({ force })
  if (failed.length) {
    log.error({ event: 'build.apply_failed', message: `re-render at start: ${failed.join('; ')}` })
    return
  }
  await settings.setAppliedBuild(config.build)
  if (force) log.info({ event: 'build.applied', message: `new build ${previous} -> ${config.build}: restarted running agents` })
}

function agentOf({ row, ownerName, state, canEdit }: { row: AgentRow; ownerName: string | undefined; state: string | undefined; canEdit: boolean }): Agent {
  return {
    id: row.id, object: 'agent', name: row.name, ownerId: row.owner_id, ownerName: ownerName ?? 'someone', model: row.model, wanted: row.wanted,
    status: statusOf(state), summary: summaryOf(row.instructions), net: row.net, instructions: row.instructions, canEdit, createdAt: new Date(row.created_at).toISOString(),
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

const summaryOf = (instructions: string): string => instructions.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? ''

function grantOf(row: { id: string; agent_id: string; connection_id: string; created_at: Date }): Grant {
  return { id: row.id, object: 'grant', agentId: row.agent_id, connectionId: row.connection_id, createdAt: new Date(row.created_at).toISOString() }
}

export type AgentRow = { id: string; name: string; owner_id: string; instructions: string; model: 'opus' | 'sonnet' | 'haiku'; net: number; token_version: number; wanted: 'running' | 'stopped'; channel_key: string; created_at: Date }
export type GatewayAgent = { id: string; owner_id: string; net: number }
