import type { Selectable } from 'kysely'
import { AgentRecord, ControlRecord, type Agent, type CreateAgent, type AgentHealth, type AgentStatus, type Grant, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import { viewersOf } from '@openhut/common/cloud/member-list.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { splitModelKey } from '@openhut/common/models/provider.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentToken, newId, sameSecret, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { agentd, containerStates, features, type AgentFiles } from '../platform/agentd.ts'
import { agentApiUrl } from '../platform/network.ts'
import { log, emit } from '../platform/events.ts'
import { liveService } from '../platform/live-service.ts'
import { deleted } from '../platform/responses.ts'
import { connectionService } from '../connections/connection-service.ts'
import type { Caller } from '../team/identity.ts'
import { audienceOf } from '../channels/audience.ts'
import { DiscordSecrets } from '../integrations/discord/discord.ts'
import { resolveSlots } from '../models/model-slots.ts'
import { providerService } from '../models/provider-service.ts'
import { renderFiles, type RenderedChannel } from './hermes-files.ts'
import { keysService } from '../cloud/keys-service.ts'
import { roomKeys } from '../cloud/room-keys.ts'
import { recordsService, type Held } from '../cloud/records.ts'
import { cloudEvents } from '../cloud/cloud-events.ts'
import { runSet } from '../cloud/run-set.ts'

const RECONCILE_MS = 30_000
const HEALTH_MS = 5_000
const PROBE_MS = 3_000
const PROBE_FRESH_MS = 5_000
const STARTING_MS = 180_000
const DEFAULT_MODEL = 'claude:sonnet'
const CHILDREN = ['channel', 'routine', 'skill'] as const
const held = new Map<string, boolean>()

export const agentService = {
  async list({ actor }: { actor: Caller }): Promise<Agent[]> {
    const [all, states] = await Promise.all([everything(), containerStates()])
    return Promise.all(all.map((facts) => agentOf({ facts, actor, states })))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    const [facts, states] = await Promise.all([agentService.find({ id }), containerStates()])
    return agentOf({ facts, actor, states })
  },

  async find({ id }: { id: string }): Promise<AgentFacts> {
    const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
    const home = keysService.account()?.workspace.id
    const first = row ? row.workspace ?? home : undefined
    const spaces = [...new Set([first, ...workspaces()].filter((ws): ws is string => !!ws))]
    for (const workspace of spaces) {
      const agent = await recordsService.get({ collection: 'agent', workspace, id })
      if (!agent || agent.deleted) continue
      const control = await recordsService.get({ collection: 'control', workspace, id })
      const facts = factsOf({ agent, control, row })
      if (facts) return facts
    }
    throw new HttpError(404, 'That agent doesn\'t exist. It may have been deleted.')
  },

  async requireEditable({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
    const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'That agent doesn\'t run on this computer.')
    if (!row.shared && (row.owner ?? actor.email) !== actor.email) throw new HttpError(403, `Only ${row.name}'s owner can change it.`)
    return row
  },

  async create({ actor, name, instructions, model, face, workspace }: { actor: Caller; name: string; instructions?: string } & Pick<CreateAgent, 'model' | 'face' | 'workspace'>): Promise<Agent> {
    const clean = cleanName(name)
    requireModel(model)
    const ws = workspace ?? keysService.signedIn().workspace.id
    if (!roomKeys.room(ws)) throw new HttpError(400, 'This computer isn’t in that team.', { param: 'workspace' })
    if ((await agentd.health()).imageReady === false) throw new HttpError(409, 'OpenHut is still downloading what agents need to run. This happens once and takes a few minutes. Try again shortly.')
    const id = newId('ag')
    const value: AgentRecord = { name: clean, instructions: (instructions || `# ${clean}\n\nYou are ${clean}. Answer briefly.`).slice(0, 20_000), face: face ?? null, wanted: 'stopped', createdAt: new Date().toISOString() }
    await recordsService.put({ collection: 'agent', id, workspace: ws, parent: actor.email, personal: true, value })
    const control: ControlRecord = { runsOn: await keysService.deviceKey(), model: model ?? DEFAULT_MODEL, codeExecution: true, browser: false, grants: [] }
    await recordsService.put({ collection: 'control', parent: id, workspace: ws, personal: true, value: control })
    await runSet.apply({ workspace: ws, id })
    emit({ name: 'agent.created', actor, target: { type: 'agent', id, name: clean, model: control.model } })
    return agentService.get({ actor, id })
  },

  async update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
    const facts = await agentService.find({ id })
    const { codeExecution, browser, model, runsHere, runsOn, shared, ...fields } = patch
    const controls = codeExecution !== undefined || browser !== undefined || model !== undefined || runsHere !== undefined || runsOn !== undefined || shared !== undefined
    if (controls && facts.owner !== actor.email) throw new HttpError(403, `Only ${facts.owner} can change where ${facts.value.name} runs, its model, what it can run, or who can use it.`, { param: Object.keys(patch)[0] })
    if (!controls && facts.personal && facts.owner !== actor.email) throw new HttpError(403, `Only ${facts.owner} can change ${facts.value.name}.`)
    requireModel(model === facts.control?.model ? undefined : model)
    const me = await keysService.deviceKey()
    const target = runsHere ? me : runsOn ?? facts.control?.runsOn ?? me
    if (target !== facts.control?.runsOn) requireRunner({ facts, runsOn: target, me })
    if (browser && target === me && !(await features()).browser) throw new HttpError(409, 'This computer can\'t give agents a browser. Run the agent on a Linux computer you added to use one.', { param: 'browser' })
    const personal = shared === undefined ? facts.personal : !shared
    const resealed = personal !== facts.personal
    const name = fields.name === undefined ? undefined : cleanName(fields.name)
    if (Object.keys(fields).length || resealed) {
      const change = (value: AgentRecord): AgentRecord => ({ ...value, ...fields, ...name && { name } })
      await recordsService.put({ collection: 'agent', id, workspace: facts.workspace, parent: facts.owner, personal, value: change(facts.value), reapply: (latest) => ({ value: change(AgentRecord.parse(latest.value)) }) })
    }
    if (controls) {
      const change = (value: ControlRecord): ControlRecord => ({ ...value, ...model && { model }, ...codeExecution !== undefined && { codeExecution }, ...browser !== undefined && { browser }, runsOn: target })
      await editControl({ facts, personal, change })
    }
    if (resealed) await reseal({ facts, personal })
    await runSet.apply({ workspace: facts.workspace, id })
    emit({ name: 'agent.updated', actor, target: { type: 'agent', id, fields: Object.keys(patch) } })
    return agentService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'agent'>> {
    const facts = await agentService.find({ id })
    const role = roomKeys.roleIn(facts.workspace)
    if (facts.owner !== actor.email && (role === 'member' || role === undefined)) throw new HttpError(403, `Only ${facts.value.name}'s owner or an admin of this team can delete it.`)
    const children = (await Promise.all(CHILDREN.map((collection) => recordsService.list({ collection, workspace: facts.workspace, parent: id })))).flat()
    for (const child of [...children, { collection: 'memory' as const, id }, { collection: 'control' as const, id }]) {
      await recordsService.remove({ collection: child.collection, workspace: facts.workspace, id: child.id }).catch((err: unknown) => log.warn({ event: 'agent.child_not_removed', agent: id, error: messageOf(err) }))
    }
    await recordsService.remove({ collection: 'agent', workspace: facts.workspace, id })
    await runSet.apply({ workspace: facts.workspace, id })
    emit({ name: 'agent.deleted', actor, target: { type: 'agent', id, name: facts.value.name } })
    return deleted({ id, object: 'agent' })
  },

  async wipe(): Promise<void> {
    for (const { id } of await db.selectFrom('agent').select('id').execute()) await agentd.remove({ id, trash: true }).catch((err: unknown) => log.warn({ event: 'agent.wipe_failed', agent: id, error: messageOf(err) }))
    await db.deleteFrom('agent').execute()
  },

  holdReapply(id: string): void {
    held.set(id, held.get(id) ?? false)
  },

  async releaseReapply(id: string): Promise<void> {
    const due = held.get(id)
    held.delete(id)
    if (due) await agentService.reapply({ id })
  },

  async reapply({ id }: { id: string }): Promise<void> {
    if (held.has(id)) {
      held.set(id, true)
      return
    }
    const row = await rowOf(id)
    await agentd.apply({ id, net: row.net, files: await filesOf(row), browser: row.web_browser, running: row.wanted === 'running' })
    probes.delete(id)
  },

  async stopAll(): Promise<void> {
    for (const [id, state] of Object.entries((await containerStates()) ?? {})) {
      if (state === 'running') await agentd.stop({ id }).catch((err: unknown) => log.warn({ event: 'agent.stop_failed', agent: id, error: messageOf(err) }))
    }
  },

  async statuses({ workspace }: { workspace: string }): Promise<Record<string, { status: AgentStatus; health: AgentHealth | null }>> {
    const home = keysService.account()?.workspace.id
    const rows = await db.selectFrom('agent').selectAll().execute()
    const states = await containerStates()
    const mine = rows.filter((row) => (row.workspace ?? home) === workspace)
    return Object.fromEntries(await Promise.all(mine.map(async (row) => [row.id, { status: statusOf(states?.[row.id]), health: (await healthOf({ row, state: states?.[row.id] })).health }] as const)))
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
    const all = agentId ? [await agentService.find({ id: agentId })] : await everything()
    return all.flatMap((facts) => (facts.control?.grants ?? []).filter((grant) => !connectionId || grant.connection === connectionId)
      .map((grant) => grantOf({ agentId: facts.id, connectionId: grant.connection, at: grant.at })))
  },

  async createGrant({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<Grant> {
    const facts = await requireOwner({ actor, id: agentId })
    await connectionService.get({ actor, id: connectionId })
    const at = new Date().toISOString()
    await editControl({ facts, change: (value) => value.grants.some((grant) => grant.connection === connectionId) ? value : { ...value, grants: [...value.grants, { connection: connectionId, at }] } })
    await runSet.apply({ workspace: facts.workspace, id: agentId })
    const grant = grantOf({ agentId, connectionId, at: facts.control?.grants.find((each) => each.connection === connectionId)?.at ?? at })
    emit({ name: 'grant.created', actor, target: { type: 'grant', id: grant.id, agentId, connectionId } })
    return grant
  },

  async deleteGrant({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'grant'>> {
    const [agentId = '', connectionId = ''] = id.split('~')
    const facts = await requireOwner({ actor, id: agentId })
    if (!facts.control?.grants.some((grant) => grant.connection === connectionId)) throw new HttpError(404, 'That grant doesn\'t exist. It may have been removed already.')
    await editControl({ facts, change: (value) => ({ ...value, grants: value.grants.filter((grant) => grant.connection !== connectionId) }) })
    await runSet.apply({ workspace: facts.workspace, id: agentId })
    emit({ name: 'grant.deleted', actor, target: { type: 'grant', id, agentId, connectionId } })
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

export function mayEdit({ facts, actor }: { facts: AgentFacts; actor: Caller }): boolean {
  return facts.owner === actor.email || !facts.personal
}

export function placeOf(row: Pick<AgentRow, 'workspace' | 'shared'>): { workspace: string; personal: boolean } {
  return { workspace: row.workspace ?? keysService.signedIn().workspace.id, personal: !row.shared }
}

async function requireOwner({ actor, id }: { actor: Caller; id: string }): Promise<AgentFacts> {
  const facts = await agentService.find({ id })
  if (facts.owner !== actor.email) throw new HttpError(403, `Only ${facts.owner} can change what ${facts.value.name} can use.`)
  return facts
}

async function editControl({ facts, personal = facts.personal, change }: { facts: AgentFacts; personal?: boolean; change: (value: ControlRecord) => ControlRecord }): Promise<void> {
  if (!facts.control) throw new HttpError(409, `${facts.value.name}'s settings haven't arrived from OpenHut Cloud yet. Try again in a moment.`)
  await recordsService.put({ collection: 'control', parent: facts.id, workspace: facts.workspace, personal, value: change(facts.control), reapply: (latest) => ({ value: change(ControlRecord.parse(latest.value)) }) })
}

async function reseal({ facts, personal }: { facts: AgentFacts; personal: boolean }): Promise<void> {
  const memory = await recordsService.get({ collection: 'memory', workspace: facts.workspace, id: facts.id })
  const children = (await Promise.all(CHILDREN.map(async (collection) => (await recordsService.list({ collection, workspace: facts.workspace, parent: facts.id })).map((child) => ({ ...child, collection }))))).flat()
  if (memory && !memory.deleted) await recordsService.put({ collection: 'memory', parent: facts.id, workspace: facts.workspace, personal, value: memory.value })
  for (const child of children) await recordsService.put({ collection: child.collection, id: child.id, parent: facts.id, workspace: facts.workspace, personal, value: child.value, secret: child.secret })
}

function requireRunner({ facts, runsOn, me }: { facts: AgentFacts; runsOn: string; me: string }): void {
  const list = roomKeys.members(facts.workspace)
  const ok = runsOn === me || (!!list && !viewersOf(list).includes(runsOn) && !list.removed.includes(runsOn) && list.members.some((member) => member.email === facts.owner && member.kit !== runsOn && member.devices.includes(runsOn)))
  if (!ok) throw new HttpError(400, `${facts.value.name} can only run on one of ${facts.owner}'s own computers.`, { param: 'runsOn' })
}

function workspaces(): string[] {
  return keysService.account() ? roomKeys.rooms().map((room) => room.workspace.id) : []
}

async function everything(): Promise<AgentFacts[]> {
  const rows = await db.selectFrom('agent').selectAll().orderBy('created_at').execute()
  const byId = new Map(rows.map((row) => [row.id, row]))
  try {
    const found = await Promise.all(workspaces().map(async (workspace) => {
      const [agents, controls] = await Promise.all([recordsService.list({ collection: 'agent', workspace }), recordsService.list({ collection: 'control', workspace })])
      const control = new Map(controls.map((each) => [each.id, each]))
      return agents.flatMap((agent) => factsOf({ agent, control: control.get(agent.id) ?? null, row: byId.get(agent.id) }) ?? [])
    }))
    return found.flat().sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt))
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 502) throw error
    const me = await keysService.deviceKey()
    return rows.map((row) => heldFacts({ row, me }))
  }
}

function factsOf({ agent, control, row }: { agent: Held; control: Held | null; row: AgentRow | undefined }): AgentFacts | null {
  const value = AgentRecord.safeParse(agent.value).data
  if (!value || !agent.parent) return null
  return { id: agent.id, workspace: agent.workspace, owner: agent.parent, personal: !!agent.personal, by: agent.by, value, control: ControlRecord.safeParse(control?.value).data ?? null, row }
}

function heldFacts({ row, me }: { row: AgentRow; me: string }): AgentFacts {
  const { workspace, personal } = placeOf(row)
  return {
    id: row.id, workspace, owner: row.owner ?? keysService.account()?.email ?? '', personal, by: null, row,
    value: { name: row.name, instructions: row.instructions, face: row.face, wanted: row.wanted, createdAt: new Date(row.created_at).toISOString() },
    control: { runsOn: row.runs_on ?? me, model: row.model, codeExecution: row.code_execution, browser: row.web_browser, grants: [] },
  }
}

async function agentOf({ facts, actor, states }: { facts: AgentFacts; actor: Caller; states: Record<string, string> | undefined }): Promise<Agent> {
  const me = await keysService.deviceKey()
  const { value, control, row } = facts
  const here = !!row && control?.runsOn === me
  const list = roomKeys.members(facts.workspace)
  const runner = list?.members.find((member) => control && member.devices.includes(control.runsOn))
  const beat = control && !here ? cloudEvents.beats(facts.workspace).get(control.runsOn)?.agents?.[facts.id] : undefined
  const health = here ? await healthOf({ row, state: states?.[facts.id] }) : { health: beat?.health ?? null, detail: '' }
  const author = facts.by ? list?.members.find((member) => member.devices.includes(facts.by ?? ''))?.email : undefined
  const mine = facts.owner === actor.email
  return {
    id: facts.id, object: 'agent', name: value.name, ownerId: facts.owner, ownerName: facts.owner, model: control?.model ?? DEFAULT_MODEL, wanted: value.wanted,
    status: here ? statusOf(states?.[facts.id]) : beat?.status ?? 'missing', health: health.health, healthDetail: health.detail, summary: summaryOf(value.instructions), net: here ? row.net : 0,
    instructions: value.instructions, codeExecution: control?.codeExecution ?? true, browser: control?.browser ?? false, face: value.face, canEdit: mayEdit({ facts, actor }),
    runsHere: here, runsNowhere: !here && (!control || !runner || !!list?.removed.includes(control.runsOn)), runsOn: control?.runsOn ?? null, runsOnName: here || !control ? null : list?.names?.[control.runsOn] ?? (runner ? `${runner.email}’s computer` : null),
    changedBy: author && author !== actor.email ? author : null, workspace: facts.workspace === keysService.account()?.workspace.id ? null : facts.workspace, shared: !facts.personal, owner: facts.owner,
    canManage: mine, createdAt: value.createdAt,
  }
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

function requireModel(model: string | undefined): void {
  if (model) providerService.requireUsable({ key: model, param: 'model' })
}

const rowOf = (id: string): Promise<AgentRow> => findRow({ table: 'agent', id, missing: 'That agent doesn\'t exist. It may have been deleted.' })

async function tellAgent(id: string): Promise<void> {
  await agentService.reapply({ id }).catch((err: unknown) => log.warn({ event: 'agent.reapply_failed', agent: id, error: messageOf(err) }))
}

async function filesOf(row: AgentRow): Promise<AgentFiles> {
  const channels = await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).orderBy('kind').execute()
  const slots = resolveSlots({ model: row.model, catalog: providerService.catalog })
  return renderFiles({
    agent: { ...row, slots }, ownerName: row.owner ?? keysService.account()?.email ?? 'its owner', token: agentToken({ id: row.id, epoch: row.token_epoch }), channelKey: unseal(row.channel_key),
    channels: channels.filter((channel) => channel.kind !== 'telegram' || channel.status === 'connected').map(renderedChannel), connections: await connectionService.reachable({ agent: row }),
  })
}

function renderedChannel(channel: Selectable<Database['channel']>): RenderedChannel {
  const audience = audienceOf(channel)
  switch (channel.kind) {
    case 'whatsapp': return { kind: 'whatsapp', audience }
    case 'slack': return { kind: 'slack', audience }
    case 'telegram': return { kind: 'telegram', audience }
    case 'discord': return { kind: 'discord', audience, ...DiscordSecrets.parse(JSON.parse(unseal(channel.secrets))) }
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

export function runsHere({ row, me }: { row: Pick<AgentRow, 'runs_on'>; me: string | null }): boolean {
  return !row.runs_on || row.runs_on === me
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
  if (!last.detail && config.modelMode === 'claude' && !providerService.connected(provider)) return { health: 'no_seat', detail: `${providerService.get({ id: provider }).name} isn't connected on this computer, so its model can't answer. Connect it under Settings › Models.` }
  if (!last.detail) return { health: 'answering', detail: '' }
  return { health: Date.now() - last.failingSince > STARTING_MS ? 'not_answering' : 'starting', detail: last.detail }
}

async function probe({ row, fresh }: { row: AgentRow; fresh: boolean }): Promise<Probe> {
  const last = probes.get(row.id)
  if (last && !fresh && Date.now() - last.at < PROBE_FRESH_MS) return last
  const detail = await fetch(`${agentApiUrl(row.net)}/v1/models`, { headers: { authorization: `Bearer ${unseal(row.channel_key)}` }, signal: AbortSignal.timeout(PROBE_MS) })
    .then((res) => res.ok ? '' : 'The agent returned an error.')
    .catch((err: unknown) => unreachable(err))
  const next = { at: Date.now(), detail, failingSince: detail && last?.detail ? last.failingSince : Date.now() }
  probes.set(row.id, next)
  return next
}

export function unreachable(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return `The agent didn't answer within ${PROBE_MS / 1000} seconds.`
  return 'The agent isn\'t answering.'
}

type Probe = { at: number; detail: string; failingSince: number }
type Health = { health: AgentHealth | null; detail: string }

const summaryOf = (instructions: string): string => (instructions.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? '')
  .replace(/^([-*+>]|\d+\.)\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+|__|`/g, '')

function grantOf({ agentId, connectionId, at }: { agentId: string; connectionId: string; at: string }): Grant {
  return { id: `${agentId}~${connectionId}`, object: 'grant', agentId, connectionId, createdAt: at }
}

export function cleanName(name: string): string {
  const clean = name.trim().replace(/[^\w .-]/g, '').slice(0, 40)
  if (!clean) throw new HttpError(400, 'Give the agent a name with letters or digits.', { param: 'name' })
  return clean
}

export type AgentRow = Selectable<Database['agent']>
export type GatewayAgent = { id: string; owner_id: string; net: number }
export type AgentFacts = { id: string; workspace: string; owner: string; personal: boolean; by: string | null; value: AgentRecord; control: ControlRecord | null; row: AgentRow | undefined }
