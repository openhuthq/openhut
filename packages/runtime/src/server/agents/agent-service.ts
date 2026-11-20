import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import * as z from 'zod/mini'
import { type Agent, type CreateAgent, type AgentHealth, type AgentImport, type AgentStatus, type Grant, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import type { Export } from '@openhut/common/admin/admin.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { ChannelKind } from '@openhut/common/channels/channel.ts'
import { splitModelKey } from '@openhut/common/models/provider.ts'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'
import { db, findRow, isUniqueViolation } from '../platform/db.ts'
import { routineService } from '../routines/routine-service.ts'
import type { Database } from '../platform/db-schema.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentToken, newId, openSealed, sameSecret, seal, sealFor, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { agentd, containerStates, features, type AgentFiles } from '../platform/agentd.ts'
import { agentApiUrl } from '../platform/network.ts'
import { log, emit } from '../platform/events.ts'
import { liveService } from '../platform/live-service.ts'
import { deleted } from '../platform/responses.ts'
import { connectionService } from '../connections/connection-service.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from '../channels/audience.ts'
import { SlackSecrets } from '../integrations/slack/slack.ts'
import { resolveSlots } from '../models/model-slots.ts'
import { providerService } from '../models/provider-service.ts'
import { renderFiles, type RenderedChannel } from './hermes-files.ts'

const MAX_AGENTS = 250
const RECONCILE_MS = 30_000
const HEALTH_MS = 5_000
const PROBE_MS = 3_000
const PROBE_FRESH_MS = 5_000
const STARTING_MS = 180_000
const RENDERED = ['instructions', 'model', 'codeExecution', 'browser'] as const
const DEFAULT_MODEL = 'claude:sonnet'
const Moved = z.object({
  agent: z.object({ id: z.string().check(z.regex(/^ag_[a-z0-9]{8}$/)), name: z.string(), instructions: z.string(), model: z.string(), codeExecution: z.boolean(), browser: z.boolean() }),
  channels: z.array(z.object({ kind: ChannelKind, status: z.enum(['connected', 'linking']), account: z.nullable(z.string()), ownerAddress: z.string(), open: z.boolean(), allowed: z.string(), secrets: z.string() })),
  threads: z.array(z.object({ id: z.optional(z.string()), title: z.string(), messages: z.string(), createdAt: z.string(), updatedAt: z.string() })),
  routines: z.optional(z.array(z.object({ name: z.string(), plan: z.string(), at: z.nullable(z.string()), cron: z.nullable(z.string()), until: z.nullable(z.string()), origin: z.string() }))),
  grants: z.array(z.object({ kind: ConnectionKind, name: z.string() })),
  home: z.string(),
})
type Moved = z.infer<typeof Moved>

export const agentService = {
  async list({ actor }: { actor: Caller }): Promise<Agent[]> {
    const [rows, states] = await Promise.all([db.selectFrom('agent').selectAll().orderBy('created_at').execute(), containerStates()])
    const owners = new Map((await db.selectFrom('person').select(['id', 'email']).execute()).map((person) => [person.id, person.email]))
    return Promise.all(rows.map(async (row) => agentOf({ row, ownerName: owners.get(row.owner_id), state: states?.[row.id], health: await healthOf({ row, state: states?.[row.id] }), editable: row.owner_id === actor.id })))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    const row = await rowOf(id)
    const owner = await db.selectFrom('person').select('email').where('id', '=', row.owner_id).executeTakeFirst()
    const state = (await containerStates())?.[id]
    return agentOf({ row, ownerName: owner?.email, state, health: await healthOf({ row, state }), editable: row.owner_id === actor.id })
  },

  async requireEditable({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
    const row = await rowOf(id)
    if (row.owner_id !== actor.id) throw new HttpError(403, `Only ${row.name}'s owner can change it.`)
    return row
  },

  async create({ actor, name, instructions, model, face }: { actor: Caller; name: string; instructions?: string } & Pick<CreateAgent, 'model' | 'face'>): Promise<Agent> {
    const clean = cleanName(name)
    requireModel(model)
    const net = await freeNet()
    const row = await db.insertInto('agent').values({
      id: newId('ag'), name: clean, owner_id: actor.id, model: model ?? DEFAULT_MODEL, net, channel_key: seal(randomBytes(24).toString('hex')), face,
      instructions: (instructions || `# ${clean}\n\nYou are ${clean}. Answer briefly.`).slice(0, 20_000),
    }).returningAll().executeTakeFirstOrThrow().catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(409, 'Someone created an agent at the same moment. Try again.') : err })
    try {
      await agentd.apply({ id: row.id, net, files: await filesOf(row), browser: row.web_browser, running: false })
    } catch (err) {
      await agentd.remove({ id: row.id }).catch(() => undefined)
      await db.deleteFrom('agent').where('id', '=', row.id).execute()
      throw err
    }
    emit({ name: 'agent.created', actor, target: { type: 'agent', id: row.id, name: row.name, model: row.model } })
    return agentService.get({ actor, id: row.id })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
    const before = await agentService.requireEditable({ actor, id })
    requireModel(changed(patch.model, before.model))
    if (patch.browser && !(await features()).browser) throw new HttpError(409, 'This computer can\'t give agents a browser. Run the agent on a Linux computer you added to use one.', { param: 'browser' })
    const { codeExecution, browser, ...fields } = patch
    await db.updateTable('agent').set({
      ...fields,
      code_execution: codeExecution, web_browser: browser, name: patch.name === undefined ? undefined : cleanName(patch.name),
    }).where('id', '=', id).execute()
    if (patch.wanted || RENDERED.some((field) => patch[field] !== undefined)) {
      await agentService.reapply({ id }).catch(async (err: unknown) => {
        if (browser === undefined || browser === before.web_browser) throw err
        await db.updateTable('agent').set({ web_browser: before.web_browser }).where('id', '=', id).execute()
        await agentService.reapply({ id }).catch(() => undefined)
        throw err
      })
    }
    emit({ name: 'agent.updated', actor, target: { type: 'agent', id, fields: Object.keys(patch) } })
    return agentService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'agent'>> {
    const row = await rowOf(id)
    await agentd.remove({ id })
    await db.deleteFrom('agent').where('id', '=', id).execute()
    emit({ name: 'agent.deleted', actor, target: { type: 'agent', id, name: row.name } })
    return deleted({ id, object: 'agent' })
  },

  async exportSealed({ actor, id, publicKey }: { actor: Caller; id: string; publicKey: string }): Promise<Export> {
    const row = await agentService.requireEditable({ actor, id })
    if ((await containerStates())?.[id] === 'running') throw new HttpError(409, `Stop ${row.name} first, so nothing changes while it moves.`)
    const [channels, threads, grants, routines, { tar }] = await Promise.all([
      db.selectFrom('channel').selectAll().where('agent_id', '=', id).execute(),
      db.selectFrom('thread').selectAll().where('agent_id', '=', id).execute(),
      db.selectFrom('connection_grant as g').innerJoin('connection as c', 'c.id', 'g.connection_id').select(['c.kind', 'c.name']).where('g.agent_id', '=', id).execute(),
      routineService.exportFor({ agentId: id }),
      agentd.exportHome({ id }),
    ])
    const moved: Moved = {
      agent: { id, name: row.name, instructions: row.instructions, model: row.model, codeExecution: row.code_execution, browser: row.web_browser },
      channels: channels.map((each) => ({ kind: each.kind, status: each.status, account: each.account, ownerAddress: each.owner_address, open: each.open, allowed: each.allowed, secrets: each.secrets && unseal(each.secrets) })),
      threads: threads.map((each) => ({ id: each.id, title: each.title, messages: each.messages, createdAt: new Date(each.created_at).toISOString(), updatedAt: new Date(each.updated_at).toISOString() })),
      grants,
      routines,
      home: tar,
    }
    const sealed = sealedFor({ publicKey, text: JSON.stringify(moved) })
    emit({ name: 'agent.exported', actor, target: { type: 'agent', id, name: row.name } })
    return { object: 'export', sealed }
  },

  async importSealed({ actor, sealed }: { actor: Caller; sealed: string }): Promise<AgentImport> {
    const moved = movedFrom(sealed)
    const { agent } = moved
    const model = splitModelKey(agent.model)
    if (!model) throw new HttpError(400, 'This export has a model this OpenHut doesn\'t know. Update both computers and try again.', { param: 'sealed' })
    if (await db.selectFrom('agent').select('id').where('id', '=', agent.id).executeTakeFirst()) throw new HttpError(409, `${agent.name} is already on this computer.`)
    const row = await db.insertInto('agent').values({
      id: agent.id, name: agent.name, owner_id: actor.id, instructions: agent.instructions, model: `${model.provider}:${model.model}`, net: await freeNet(), channel_key: seal(randomBytes(24).toString('hex')),
      code_execution: agent.codeExecution, web_browser: agent.browser, wanted: 'stopped',
    }).returningAll().executeTakeFirstOrThrow()
    try {
      for (const channel of moved.channels) {
        await db.insertInto('channel').values({ id: newId('ch'), agent_id: row.id, kind: channel.kind, status: channel.status, account: channel.account, owner_address: channel.ownerAddress, open: channel.open, allowed: channel.allowed, secrets: channel.secrets && seal(channel.secrets) }).execute()
      }
      const threadIds = new Map<string, string>()
      for (const thread of moved.threads) {
        const threadId = newId('th')
        if (thread.id) threadIds.set(thread.id, threadId)
        await db.insertInto('thread').values({ id: threadId, agent_id: row.id, person_id: actor.id, title: thread.title, messages: thread.messages, created_at: thread.createdAt, updated_at: thread.updatedAt }).execute()
      }
      await routineService.importFor({ agentId: row.id, routines: moved.routines ?? [], threads: threadIds })
      const ungranted = await regrant({ agentId: row.id, grants: moved.grants })
      await agentd.importHome({ id: row.id, tar: moved.home })
      await agentd.apply({ id: row.id, net: row.net, files: await filesOf(row), browser: row.web_browser, running: false })
      emit({ name: 'agent.imported', actor, target: { type: 'agent', id: row.id, name: row.name } })
      return { object: 'agent_import', agent: await agentService.get({ actor, id: row.id }), ungranted }
    } catch (err) {
      await agentd.remove({ id: row.id }).catch(() => undefined)
      await db.deleteFrom('agent').where('id', '=', row.id).execute()
      throw err
    }
  },

  async reapply({ id }: { id: string }): Promise<void> {
    const row = await rowOf(id)
    await agentd.apply({ id, net: row.net, files: await filesOf(row), browser: row.web_browser, running: row.wanted === 'running' })
  },

  async stopAll(): Promise<void> {
    for (const [id, state] of Object.entries((await containerStates()) ?? {})) {
      if (state === 'running') await agentd.stop({ id }).catch((err: unknown) => log.warn({ event: 'agent.stop_failed', agent: id, error: messageOf(err) }))
    }
  },

  async byToken({ token }: { token: string }): Promise<GatewayAgent | undefined> {
    const row = await db.selectFrom('agent').select(['id', 'owner_id', 'net', 'token_epoch']).where('id', '=', token.split('.')[0]).executeTakeFirst()
    if (!row || !sameSecret({ given: token, expected: agentToken({ id: row.id, epoch: row.token_epoch }) })) return undefined
    return { id: row.id, owner_id: row.owner_id, net: row.net }
  },

  async revokeToken({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    await agentService.requireEditable({ actor, id })
    await db.updateTable('agent').set((eb) => ({ token_epoch: eb('token_epoch', '+', 1) })).where('id', '=', id).execute()
    emit({ name: 'agent.token_revoked', actor, target: { type: 'agent', id } })
    await tellAgent(id)
    return agentService.get({ actor, id })
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
    emit({ name: 'grant.created', actor, target: { type: 'grant', id: grant.id, agentId, connectionId } })
    await tellAgent(agentId)
    return grantOf(grant)
  },

  async deleteGrant({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'grant'>> {
    const grant = await findRow({ table: 'connection_grant', id, missing: 'That grant doesn\'t exist. It may have been removed already.' })
    await agentService.requireEditable({ actor, id: grant.agent_id })
    await db.deleteFrom('connection_grant').where('id', '=', id).execute()
    emit({ name: 'grant.deleted', actor, target: { type: 'grant', id, agentId: grant.agent_id, connectionId: grant.connection_id } })
    await tellAgent(grant.agent_id)
    return deleted({ id, object: 'grant' })
  },

  async reapplyAll({ force }: { force: boolean }): Promise<string[]> {
    const failed: string[] = []
    for (const row of await db.selectFrom('agent').selectAll().execute()) {
      await agentd.apply({ id: row.id, net: row.net, files: await filesOf(row), browser: row.web_browser, running: row.wanted === 'running', force })
        .catch((err: unknown) => failed.push(`${row.name}: ${messageOf(err)}`))
    }
    return failed
  },

  async boot(): Promise<void> {
    await applyRelease().catch((err: unknown) => log.error({ event: 'build.apply_failed', error: messageOf(err) }))
    await reconcileSafely()
    setInterval(() => void reconcileSafely(), RECONCILE_MS)
    setInterval(() => void watchHealth().catch((err: unknown) => log.warn({ event: 'health.watch_failed', error: messageOf(err) })), HEALTH_MS)
  },
}

async function watchHealth(): Promise<void> {
  if (!liveService.followed()) return healths.clear()
  const states = await containerStates()
  if (!states) return
  for (const row of await db.selectFrom('agent').selectAll().execute()) {
    const seen = `${statusOf(states[row.id])}:${(await healthOf({ row, state: states[row.id] })).health}`
    if (healths.has(row.id) && healths.get(row.id) !== seen) emit({ name: 'agent.health_changed', target: { type: 'agent', id: row.id, health: seen } })
    healths.set(row.id, seen)
  }
}

const reconcileSafely = () => reconcile().catch((err: unknown) => log.error({ event: 'reconcile.failed', error: messageOf(err) }))

async function reconcile(): Promise<void> {
  const states = await containerStates()
  if (!states) return
  for (const row of await db.selectFrom('agent').selectAll().where('wanted', '=', 'running').execute()) {
    if (states[row.id] === 'running') await probe({ row, fresh: true })
    await keepRunning({ row }).catch((err: unknown) => log.error({ event: 'reconcile.failed', agent: row.id, error: messageOf(err) }))
  }
}

async function freeNet(): Promise<number> {
  const used = new Set((await db.selectFrom('agent').select('net').execute()).map((row) => row.net))
  const net = Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).find((n) => !used.has(n))
  if (!net) throw new HttpError(409, `This server already runs ${MAX_AGENTS} agents. Delete one first.`)
  if ((await agentd.health()).imageReady === false) throw new HttpError(409, 'OpenHut is still downloading the agent image. This happens once, on the first start, and takes a few minutes. Try again shortly.')
  return net
}

function changed<T>(next: T | undefined, current: T): T | undefined {
  return next === current ? undefined : next
}

function requireModel(model: string | undefined): void {
  if (model) providerService.requireUsable({ key: model, param: 'model' })
}

function sealedFor({ publicKey, text }: { publicKey: string; text: string }): string {
  try {
    return sealFor({ publicKey, text })
  } catch {
    throw new HttpError(400, 'That public key isn\'t one an OpenHut computer gave. Send the publicKey from its GET /api/admin.', { param: 'publicKey' })
  }
}

function movedFrom(sealed: string): Moved {
  let text = ''
  try {
    text = openSealed(sealed)
  } catch {
    throw new HttpError(400, 'This wasn\'t sealed for this computer. Export it again with this computer\'s publicKey.', { param: 'sealed' })
  }
  const parsed = z.safeParse(Moved, JSON.parse(text))
  if (!parsed.success) throw new HttpError(400, 'This export came from an OpenHut this one doesn\'t understand. Update both computers and try again.', { param: 'sealed' })
  return parsed.data
}

async function regrant({ agentId, grants }: { agentId: string; grants: Moved['grants'] }): Promise<string[]> {
  const ungranted: string[] = []
  for (const { kind, name } of grants) {
    const here = await db.selectFrom('connection').select('id').where('kind', '=', kind).where('name', '=', name).orderBy('created_at').executeTakeFirst()
    if (here) await db.insertInto('connection_grant').values({ id: newId('gr'), agent_id: agentId, connection_id: here.id }).execute()
    else ungranted.push(name)
  }
  return ungranted
}

const rowOf = (id: string): Promise<AgentRow> => findRow({ table: 'agent', id, missing: 'That agent doesn\'t exist. It may have been deleted.' })

async function tellAgent(id: string): Promise<void> {
  await agentService.reapply({ id }).catch((err: unknown) => log.warn({ event: 'agent.reapply_failed', agent: id, error: messageOf(err) }))
}

async function filesOf(row: AgentRow): Promise<AgentFiles> {
  const owner = await db.selectFrom('person').select('email').where('id', '=', row.owner_id).executeTakeFirstOrThrow()
  const channels = await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).orderBy('kind').execute()
  const slots = resolveSlots({ model: row.model, catalog: providerService.catalog })
  return renderFiles({
    agent: { ...row, slots }, ownerName: owner.email, token: agentToken({ id: row.id, epoch: row.token_epoch }), channelKey: unseal(row.channel_key),
    channels: channels.map(renderedChannel), connections: await connectionService.reachable({ agent: row }),
  })
}

function renderedChannel(channel: Selectable<Database['channel']>): RenderedChannel {
  const audience = audienceOf(channel)
  switch (channel.kind) {
    case 'whatsapp': return { kind: 'whatsapp', audience }
    case 'slack': return { kind: 'slack', audience, ...SlackSecrets.parse(JSON.parse(unseal(channel.secrets))) }
    case 'telegram': return { kind: 'telegram', audience }
  }
}

async function keepRunning({ row }: { row: AgentRow }): Promise<void> {
  const { change } = await agentd.apply({ id: row.id, net: row.net, files: await filesOf(row), browser: row.web_browser, running: true })
  if (change !== 'none') log.info({ event: `reconcile.${change}`, agent: row.id })
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
    status: statusOf(state), health: health.health, healthDetail: health.detail, summary: summaryOf(row.instructions), net: row.net, instructions: row.instructions, codeExecution: row.code_execution, browser: row.web_browser, face: row.face, canEdit: editable, createdAt: new Date(row.created_at).toISOString(),
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
const healths = new Map<string, string>()

async function healthOf({ row, state }: { row: AgentRow; state: string | undefined }): Promise<Health> {
  if (state !== 'running') {
    probes.delete(row.id)
    return { health: null, detail: '' }
  }
  const last = await probe({ row, fresh: false })
  const provider = splitModelKey(row.model)?.provider ?? 'claude'
  if (!last.detail && config.modelMode === 'claude' && !providerService.connected(provider)) return { health: 'no_seat', detail: `${providerService.get({ id: provider }).name} isn't connected on this computer, so its model can't answer. Connect it under Settings, Models.` }
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

const summaryOf = (instructions: string): string => (instructions.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? '')
  .replace(/^([-*+>]|\d+\.)\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+|__|`/g, '')

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
