import { isStarter, starterInstructions } from '@openhut/common/asks/ask.ts'
import type { Selectable } from 'kysely'
import { AgentRecord, ControlRecord, HIDDEN_CHARACTERS, canUse, inSidebar, type Access, type Agent, type CreateAgent, type AgentHealth, type AgentStatus, type Grant, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import type { Deleted } from '@openhut/common/api.ts'
import { splitModelKey } from '@openhut/common/models/provider.ts'
import { db, findRow } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentToken, newId, sameSecret, unseal } from '../platform/secrets.ts'
import { agentd, features, type Change } from '../platform/agentd.ts'
import { agent, type AgentCtx } from '../../core/agent.ts'
import { forward } from '../relay/forward.ts'
import { log, emit } from '../platform/events.ts'
import { liveService } from '../platform/live-service.ts'
import { deleted } from '../platform/responses.ts'
import { connectionService } from '../connections/connection-service.ts'
import { isAdmin, peopleOf, type Caller } from '../team/identity.ts'
import { audienceOf } from '../channels/audience.ts'
import { resolveSlots } from '../models/model-slots.ts'
import { providerService } from '../models/provider-service.ts'
import type { RenderedChannel } from '../../plugins/channels/index.ts'
import { recordsService, type Held } from '../platform/records.ts'
import { HERE, HOME } from '../team/home.ts'
import { runSet } from './run-set.ts'
import { apply } from './apply.ts'
import { activity } from '../gateway/activity.ts'
import { wakes } from '../../core/wakes.ts'
import { turns } from '../threads/turns.ts'

const RECONCILE_MS = 30_000
const HEALTH_MS = 5_000
const PROBE_MS = 3_000
const PROBE_FRESH_MS = 5_000
const STARTING_MS = 180_000
let bootedAt = 0
const PORT_TAKEN = 'Another program answers on this agent’s port, likely another OpenHut on this computer. Quit it, then stop and start this agent.'
const DEFAULT_MODEL = 'claude:sonnet'
const CHILDREN = ['channel', 'routine', 'skill'] as const
const restarting = new Set<string>()
const moving = new Set<string>()

export const agentService = {
  async list({ actor }: { actor: Caller }): Promise<Agent[]> {
    const [all, states] = await Promise.all([everything(), agent.status()])
    return Promise.all(all.filter((facts) => mayUse({ access: accessOf(facts), actor })).map((facts) => agentOf({ facts, actor, states })))
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    const [facts, states] = await Promise.all([agentService.find({ id }), agent.status()])
    if (!mayUse({ access: accessOf(facts), actor })) throw new HttpError(404, 'That agent doesn\'t exist. It may have been deleted.')
    return agentOf({ facts, actor, states })
  },

  async visibleIds({ actor }: { actor: Caller }): Promise<Set<string>> {
    const rows = await db.selectFrom('agent').select(['id', 'owner', 'shared', 'people']).execute()
    return new Set(rows.filter((row) => mayUse({ access: rowAccess({ row, actor }), actor })).map((row) => row.id))
  },

  async requireVisible({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    if (!(await agentService.visibleIds({ actor })).has(id)) throw new HttpError(404, 'That agent doesn\'t exist. It may have been deleted.')
  },

  async find({ id }: { id: string }): Promise<AgentFacts> {
    const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
    const agent = await recordsService.get({ collection: 'agent', workspace: HOME, id })
    const control = agent && await recordsService.get({ collection: 'control', workspace: HOME, id })
    const facts = agent && factsOf({ agent, control, row })
    if (facts) return facts
    throw new HttpError(404, 'That agent doesn\'t exist. It may have been deleted.')
  },

  async requireUse({ actor, id }: { actor: Caller; id: string }): Promise<AgentRow> {
    const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'That agent doesn\'t run on this computer.')
    if (!mayUse({ access: rowAccess({ row, actor }), actor })) throw new HttpError(403, `Ask ${row.owner ?? 'its owner'} to give you access to ${row.name}.`)
    return row
  },

  async requireOwner({ actor, id }: { actor: Caller; id: string }): Promise<AgentFacts> {
    const facts = await agentService.find({ id })
    if (!mayEdit({ facts, actor })) throw new HttpError(403, `Only ${facts.owner} or an admin can change ${facts.value.name}, its tools, keys and token, or answer its requests. You can chat with it.`)
    return facts
  },

  async create({ actor, name, instructions, model, face, workspace, shared = false, people = [], sidebars = [], runsOn = HERE }: { actor: Caller; name: string; instructions?: string } & Pick<CreateAgent, 'model' | 'face' | 'workspace' | 'shared' | 'people' | 'sidebars' | 'runsOn'>): Promise<Agent> {
    const clean = cleanName(name)
    requireModel(model)
    if (workspace && workspace !== HOME) throw new HttpError(400, 'This install has one team.', { param: 'workspace' })
    const ws = HOME
    const health = await requireComputer(runsOn)
    const access = await teamOnly({ owner: actor.email, people, sidebars })
    const id = newId('ag')
    const value: AgentRecord = { name: clean, instructions: (instructions || starterInstructions(clean)).slice(0, 20_000), face: face ?? null, wanted: 'stopped', createdAt: new Date().toISOString() }
    await recordsService.put({ collection: 'agent', id, workspace: ws, parent: actor.email, personal: !shared, value })
    const control: ControlRecord = { runsOn, model: model ?? DEFAULT_MODEL, codeExecution: true, browser: !!health.features?.browser, grants: [], ...access }
    await recordsService.put({ collection: 'control', parent: id, workspace: ws, personal: !shared, value: control })
    emit({ name: 'agent.created', actor, target: { type: 'agent', id, name: clean, model: control.model } })
    return agentService.get({ actor, id })
  },

  update({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
    return updated({ actor, id, patch })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'agent'>> {
    const facts = await agentService.find({ id })
    if (!mayEdit({ facts, actor })) throw new HttpError(403, `Only ${facts.value.name}'s owner or an admin of this team can delete it.`)
    const children = (await Promise.all(CHILDREN.map((collection) => recordsService.list({ collection, workspace: facts.workspace, parent: id })))).flat()
    for (const child of [...children, { collection: 'memory' as const, id }, { collection: 'control' as const, id }]) {
      await recordsService.remove({ collection: child.collection, workspace: facts.workspace, id: child.id }).catch((err: unknown) => log.warn({ event: 'agent.child_not_removed', agent: id, error: messageOf(err) }))
    }
    await recordsService.remove({ collection: 'agent', workspace: facts.workspace, id })
    emit({ name: 'agent.deleted', actor, target: { type: 'agent', id, name: facts.value.name } })
    return deleted({ id, object: 'agent' })
  },

  async wipe(): Promise<void> {
    for (const { id } of await db.selectFrom('agent').select('id').execute()) await agent.remove(id, { keep: true }).catch((err: unknown) => log.warn({ event: 'agent.wipe_failed', agent: id, error: messageOf(err) }))
    await db.deleteFrom('agent').execute()
  },

  async ownerOf({ id }: { id: string }): Promise<Caller> {
    const facts = await agentService.find({ id })
    const person = await db.selectFrom('person').select(['id', 'email', 'role']).where('email', '=', facts.owner).where('removed_at', 'is', null).executeTakeFirst()
    if (!person) throw new HttpError(409, `${facts.value.name}'s owner isn't on the team any more, so it can't change itself. An admin can make someone else its owner.`)
    return person
  },

  async retryApply({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    await requireOwner({ actor, id })
    await apply.request(id)
    return agentService.get({ actor, id })
  },

  restartPending(id: string): boolean {
    return restarting.has(id)
  },

  async reapply({ id }: { id: string }): Promise<void> {
    await put({ row: await rowOf(id) })
    probes.delete(id)
  },

  async stopAll(): Promise<void> {
    for (const [id, state] of Object.entries((await agent.status()) ?? {})) {
      if (state === 'running') await agent.stop(id).catch((err: unknown) => log.warn({ event: 'agent.stop_failed', agent: id, error: messageOf(err) }))
    }
  },

  async statuses({ workspace }: { workspace?: string } = {}): Promise<Record<string, { status: AgentStatus; health: AgentHealth | null; detail?: string }>> {
    const rows = await db.selectFrom('agent').selectAll().execute()
    const states = await agent.status()
    const mine = workspace ? rows.filter((row) => (row.workspace ?? HOME) === workspace) : rows
    return Object.fromEntries(await Promise.all(mine.map(async (row) => {
      const { health, detail } = await healthOf({ row, state: states?.[row.id] })
      return [row.id, { status: statusOf(states?.[row.id]), health: health === 'setup_failed' ? 'not_answering' : health, ...detail && { detail } }] as const
    })))
  },

  async byToken({ token, from }: { token: string; from?: string }): Promise<GatewayAgent | undefined> {
    const row = await db.selectFrom('agent').select(['id', 'owner_id', 'net', 'token_epoch', 'runs_on']).where('id', '=', token.split('.')[0]).executeTakeFirst()
    if (!row || !sameSecret({ given: token, expected: agentToken({ id: row.id, epoch: row.token_epoch }) })) return undefined
    if (from && (from !== (row.runs_on ?? HERE) || moving.has(row.id))) return undefined
    return { id: row.id, owner_id: row.owner_id, net: row.net }
  },

  async revokeToken({ actor, id }: { actor: Caller; id: string }): Promise<Agent> {
    await agentService.requireOwner({ actor, id })
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

  createGrant({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<Grant> {
    return granted({ actor, agentId, connectionId })
  },

  deleteGrant({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'grant'>> {
    return ungranted({ actor, id })
  },

  async sync({ computer }: { computer: string }): Promise<void> {
    const states = await agent.status({ on: computer }) ?? {}
    const here = async (id: string) => {
      const row = await db.selectFrom('agent').select('runs_on').where('id', '=', id).executeTakeFirst()
      return !moving.has(id) && !!row && (row.runs_on ?? HERE) === computer
    }
    for (const id of Object.keys(states)) {
      if (moving.has(id) || await here(id)) continue
      await agent.remove(id, { on: computer, keep: true })
      log.info({ event: 'agent.stray_removed', agent: id, computer })
    }
    for (const row of await db.selectFrom('agent').selectAll().execute()) {
      if (!await here(row.id)) continue
      await put({ row, on: computer })
        .catch((err: unknown) => log.warn({ event: 'agent.sync_failed', agent: row.id, computer, error: messageOf(err) }))
    }
  },

  // Just booted: its agents are still coming up, so a message waits for them instead of failing.
  booting: (): boolean => Date.now() - bootedAt < STARTING_MS,

  async boot(): Promise<void> {
    bootedAt = Date.now()
    if (!forward.linked(HERE)) await agentService.sync({ computer: HERE }).catch((err: unknown) => log.info({ event: 'agent.sync_waits', computer: HERE, error: messageOf(err) }))
    await reconcileSafely()
    setInterval(() => void reconcileSafely(), RECONCILE_MS)
    setInterval(() => void watchHealth().catch((err: unknown) => log.warn({ event: 'health.watch_failed', error: messageOf(err) })), HEALTH_MS)
  },
}

export function mayEdit({ facts, actor }: { facts: AgentFacts; actor: Caller }): boolean {
  return facts.owner === actor.email || isAdmin(actor)
}

function modelNameOf(key: string): string | null {
  const split = splitModelKey(key)
  return split ? providerService.catalog(split.provider).find((model) => model.id === split.model)?.name ?? null : null
}

export function placeOf(row: Pick<AgentRow, 'workspace' | 'shared'>): { workspace: string; personal: boolean } {
  return { workspace: row.workspace ?? HOME, personal: !row.shared }
}

async function granted({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<Grant> {
  const facts = await requireOwner({ actor, id: agentId })
  await connectionService.get({ actor, id: connectionId })
  const at = new Date().toISOString()
  await editControl({ facts, change: (value) => value.grants.some((grant) => grant.connection === connectionId) ? value : { ...value, grants: [...value.grants, { connection: connectionId, at }] } })
  const grant = grantOf({ agentId, connectionId, at: facts.control?.grants.find((each) => each.connection === connectionId)?.at ?? at })
  emit({ name: 'grant.created', actor, target: { type: 'grant', id: grant.id, agentId, connectionId } })
  return grant
}

async function ungranted({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'grant'>> {
  const [agentId = '', connectionId = ''] = id.split('~')
  const facts = await requireOwner({ actor, id: agentId })
  if (!facts.control?.grants.some((grant) => grant.connection === connectionId)) throw new HttpError(404, 'That grant doesn\'t exist. It may have been removed already.')
  await editControl({ facts, change: (value) => ({ ...value, grants: value.grants.filter((grant) => grant.connection !== connectionId) }) })
  emit({ name: 'grant.deleted', actor, target: { type: 'grant', id, agentId, connectionId } })
  return deleted({ id, object: 'grant' })
}

async function updated({ actor, id, patch }: { actor: Caller; id: string; patch: UpdateAgent }): Promise<Agent> {
  const found = await agentService.find({ id })
  const { codeExecution, browser, model, runsHere, runsOn, shared, people, sidebars, ...fields } = patch
  const controls = codeExecution !== undefined || browser !== undefined || model !== undefined || runsHere !== undefined || runsOn !== undefined || shared !== undefined || people !== undefined || sidebars !== undefined
  if (controls && !mayEdit({ facts: found, actor })) throw new HttpError(403, `Only ${found.owner} or an admin can change where ${found.value.name} runs, its model, what it can run, or who can use it.`, { param: Object.keys(patch)[0] })
  if (!controls && !mayEdit({ facts: found, actor })) throw new HttpError(403, `Only ${found.owner} or an admin can change ${found.value.name}. You can chat with it.`)
  requireModel(model === found.control?.model ? undefined : model)
  const from = found.control?.runsOn ?? HERE
  const target = runsHere ? HERE : runsOn ?? from
  if (browser && !(await features({ on: target })).browser) throw new HttpError(409, 'That computer can\'t give agents a browser.', { param: 'browser' })
  if (target !== from) await move({ facts: found, from, to: target })
  const facts = target === from ? found : await agentService.find({ id })
  const personal = shared === undefined ? facts.personal : !shared
  const access = people || sidebars ? await teamOnly({ owner: facts.owner, people: people ?? facts.control?.people ?? [], sidebars: sidebars ?? facts.control?.sidebars ?? [] }) : {}
  const resealed = personal !== facts.personal
  const name = fields.name === undefined ? undefined : cleanName(fields.name)
  if (Object.keys(fields).length || resealed) {
    const change = (value: AgentRecord): AgentRecord => ({ ...value, ...name && fields.instructions === undefined && isStarter(value) && { instructions: starterInstructions(name) }, ...fields, ...name && { name } })
    await recordsService.put({ collection: 'agent', id, workspace: facts.workspace, parent: facts.owner, personal, value: change(facts.value), reapply: (latest) => ({ value: change(AgentRecord.parse(latest.value)) }) })
  }
  if (controls) {
    const change = (value: ControlRecord): ControlRecord => ({ ...value, ...model && { model }, ...codeExecution !== undefined && { codeExecution }, ...browser !== undefined && { browser }, ...access })
    await editControl({ facts, personal, change })
  }
  if (resealed) await reseal({ facts, personal })
  emit({ name: 'agent.updated', actor, target: { type: 'agent', id, fields: Object.keys(patch) } })
  return agentService.get({ actor, id })
}

async function put({ row, on }: { row: AgentRow; on?: string }): Promise<Change> {
  const change = await applied(row, agent.setup({ ctx: await ctxOf(row), on, browser: row.web_browser, running: row.wanted === 'running', restart: false }))
  if (change === 'pending') restartWhenQuiet(row.id)
  endTurns({ id: row.id, change })
  return change
}

function endTurns({ id, change }: { id: string; change: Change }): void {
  if (change === 'restarted' || change === 'stopped') turns.stopAgent(id)
}

function restartWhenQuiet(id: string): void {
  if (restarting.has(id)) return
  restarting.add(id)
  void activity.quiet({ agentId: id, ms: config.quietMs })
    .then(async () => {
      const row = await rowOf(id)
      endTurns({ id, change: await applied(row, agent.setup({ ctx: await ctxOf(row), browser: row.web_browser, running: row.wanted === 'running' })) })
    })
    .catch((err: unknown) => log.warn({ event: 'agent.restart_failed', agent: id, error: messageOf(err) }))
    .finally(() => {
      restarting.delete(id)
      probes.delete(id)
      wakes.nudge(id)
    })
}

async function requireOwner({ actor, id }: { actor: Caller; id: string }): Promise<AgentFacts> {
  const facts = await agentService.find({ id })
  if (!mayEdit({ facts, actor })) throw new HttpError(403, `Only ${facts.owner} or an admin can change what ${facts.value.name} can use.`)
  return facts
}

async function editControl({ facts, personal = facts.personal, change }: { facts: AgentFacts; personal?: boolean; change: (value: ControlRecord) => ControlRecord }): Promise<void> {
  if (!facts.control) throw new HttpError(409, `${facts.value.name}'s settings aren't saved yet. Try again in a moment.`)
  await recordsService.put({ collection: 'control', parent: facts.id, workspace: facts.workspace, personal, value: change(facts.control), reapply: (latest) => ({ value: change(ControlRecord.parse(latest.value)) }) })
}

async function reseal({ facts, personal }: { facts: AgentFacts; personal: boolean }): Promise<void> {
  const memory = await recordsService.get({ collection: 'memory', workspace: facts.workspace, id: facts.id })
  const children = (await Promise.all(CHILDREN.map(async (collection) => (await recordsService.list({ collection, workspace: facts.workspace, parent: facts.id })).map((child) => ({ ...child, collection }))))).flat()
  if (memory && !memory.deleted) await recordsService.put({ collection: 'memory', parent: facts.id, workspace: facts.workspace, personal, value: memory.value })
  for (const child of children) await recordsService.put({ collection: child.collection, id: child.id, parent: facts.id, workspace: facts.workspace, personal, value: child.value, secret: child.secret })
}

async function requireComputer(id: string) {
  const row = await db.selectFrom('computer').select('name').where('id', '=', id).where('expires_at', 'is', null).executeTakeFirst()
  if (!row && id !== HERE) throw new HttpError(400, 'That computer isn’t part of this install.', { param: 'runsOn' })
  if (!forward.online(id)) throw new HttpError(409, 'That computer is offline. Start it, or pick another one.', { param: 'runsOn' })
  const health = await agentd.health({ on: id })
  if (health.imageReady === false) throw new HttpError(409, `${row?.name || 'That computer'} is still getting ready (loading what agents need to run). This happens once. Try again in a few minutes.`, { param: 'runsOn' })
  return health
}

async function move({ facts, from, to }: { facts: AgentFacts; from: string; to: string }): Promise<void> {
  await requireComputer(to)
  if (!forward.online(from)) throw new HttpError(409, `The computer ${facts.value.name} runs on is offline, so its memory and files can’t be copied. Start it, then move ${facts.value.name}.`, { param: 'runsOn' })
  const place = (runsOn: string) => editControl({ facts, change: (value) => ({ ...value, runsOn }) })
  await activity.quiet({ agentId: facts.id, ms: config.quietMs })
  if (moving.has(facts.id)) throw new HttpError(409, `${facts.value.name} is already moving. Wait for it to finish.`, { param: 'runsOn' })
  moving.add(facts.id)
  try {
    await agent.stop(facts.id, { on: from })
    try {
      await copyHome({ id: facts.id, from, to })
      await place(to)
      await runSet.settle(facts.id)
    } catch (err) {
      await place(from).catch(() => undefined)
      await agent.remove(facts.id, { on: to }).catch(() => undefined)
      await runSet.settle(facts.id).catch((again: unknown) => log.error({ event: 'agent.move_undo_failed', agent: facts.id, error: messageOf(again) }))
      throw new HttpError(502, `Couldn’t move ${facts.value.name}, so it stays where it was. ${messageOf(err)}`, { param: 'runsOn' })
    }
    await agent.remove(facts.id, { on: from, keep: true }).catch((err: unknown) => log.warn({ event: 'agent.move_cleanup_failed', agent: facts.id, error: messageOf(err) }))
    emit({ name: 'agent.moved', target: { type: 'agent', id: facts.id, from, to } })
  } finally {
    moving.delete(facts.id)
  }
}

export async function copyHome({ id, from, to }: { id: string; from: string; to: string }): Promise<void> {
  const source = forward.open({ on: from, request: { to: 'pack', id } })
  const target = forward.open({ on: to, request: { to: 'unpack', id } })
  const said = new Promise<string>((resolve, reject) => {
    let text = ''
    target.setEncoding('utf8')
    target.on('data', (chunk: string) => { text += chunk })
    target.on('end', () => resolve(text))
    target.on('close', () => reject(new Error('The other computer went offline while copying.')))
    target.on('error', reject)
  })
  source.on('close', () => { if (!source.readableEnded) target.destroy() })
  target.on('close', () => source.destroy())
  source.pipe(target)
  const reply = await said.catch((err: unknown) => { throw new Error(`Its memory and files couldn’t be copied: ${messageOf(err)}`) })
  if (reply !== 'ok') throw new Error(`Its memory and files couldn’t be saved there: ${reply.slice(0, 300) || 'no answer'}.`)
}

function mayUse({ access, actor }: { access: Access; actor: Caller }): boolean {
  return isAdmin(actor) || canUse(access, actor.email)
}

function rowAccess({ row, actor }: { row: Pick<AgentRow, 'owner' | 'shared' | 'people'>; actor: Caller }): Access {
  return { owner: row.owner ?? actor.email, shared: row.shared, people: peopleOf(row.people), sidebars: [] }
}

function accessOf(facts: Pick<AgentFacts, 'personal' | 'owner' | 'control'>): Access {
  return { owner: facts.owner, shared: !facts.personal, people: facts.control?.people ?? [], sidebars: facts.control?.sidebars ?? [] }
}

async function teamOnly({ owner, people, sidebars }: { owner: string; people: string[]; sidebars: string[] }): Promise<{ people: string[]; sidebars: string[] }> {
  const members = new Set([owner, ...(await db.selectFrom('person').select('email').where('removed_at', 'is', null).execute()).map((row) => row.email)])
  const clean = (emails: string[]) => [...new Set(emails.map((email) => email.toLowerCase()))].filter((email) => email !== owner)
  const outside = [...clean(people), ...clean(sidebars)].find((email) => !members.has(email))
  if (outside) throw new HttpError(400, `${outside} isn’t on this team yet. Invite them first.`, { param: 'people' })
  return { people: clean(people), sidebars: clean(sidebars) }
}

async function everything(): Promise<AgentFacts[]> {
  const rows = await db.selectFrom('agent').selectAll().execute()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const [agents, controls] = await Promise.all([recordsService.list({ collection: 'agent', workspace: HOME }), recordsService.list({ collection: 'control', workspace: HOME })])
  const control = new Map(controls.map((each) => [each.id, each]))
  return agents.flatMap((agent) => factsOf({ agent, control: control.get(agent.id) ?? null, row: byId.get(agent.id) }) ?? []).sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt))
}

function factsOf({ agent, control, row }: { agent: Held; control: Held | null; row: AgentRow | undefined }): AgentFacts | null {
  const value = AgentRecord.safeParse(agent.value).data
  if (!value || !agent.parent) return null
  return { id: agent.id, workspace: agent.workspace, owner: agent.parent, personal: !!agent.personal, by: agent.by, value, control: ControlRecord.safeParse(control?.value).data ?? null, row }
}

async function agentOf({ facts, actor, states }: { facts: AgentFacts; actor: Caller; states: Record<string, string> | undefined }): Promise<Agent> {
  const { value, control, row } = facts
  const here = !!row
  const health = here ? await healthOf({ row, state: states?.[facts.id] }) : { health: null, detail: '' }
  return {
    id: facts.id, object: 'agent', name: value.name, ownerId: facts.owner, ownerName: facts.owner, model: control?.model ?? DEFAULT_MODEL, modelName: modelNameOf(control?.model ?? DEFAULT_MODEL), wanted: value.wanted,
    status: here ? statusOf(states?.[facts.id]) : 'missing', health: health.health, healthDetail: health.detail, summary: summaryOf(value.instructions), net: here ? row.net : 0,
    instructions: value.instructions, codeExecution: control?.codeExecution ?? true, browser: control?.browser ?? false, face: value.face, canEdit: mayEdit({ facts, actor }),
    runsHere: here, runsNowhere: !here, runsOn: control?.runsOn ?? null, runsOnName: null, runsOnServer: false,
    changedBy: null, workspace: null, shared: !facts.personal, people: facts.control?.people ?? [], sidebars: facts.control?.sidebars ?? [], inSidebar: inSidebar(accessOf(facts), actor.email), owner: facts.owner,
    canManage: mayEdit({ facts, actor }), ...apply.state(facts.id), createdAt: value.createdAt,
  }
}

async function watchHealth(): Promise<void> {
  if (!liveService.followed()) return healths.clear()
  const states = await agent.status()
  if (!states) return
  for (const row of await db.selectFrom('agent').selectAll().execute()) {
    const seen = `${statusOf(states[row.id])}:${(await healthOf({ row, state: states[row.id] })).health}`
    if (healths.has(row.id) && healths.get(row.id) !== seen) emit({ name: 'agent.health_changed', target: { type: 'agent', id: row.id, health: seen } })
    healths.set(row.id, seen)
  }
}

const reconcileSafely = () => reconcile().catch((err: unknown) => log.error({ event: 'reconcile.failed', error: messageOf(err) }))

async function reconcile(): Promise<void> {
  const states = await agent.status()
  if (!states) return
  for (const row of await db.selectFrom('agent').selectAll().where('wanted', '=', 'running').execute()) {
    if (moving.has(row.id) || !forward.online(row.runs_on ?? HERE)) continue
    if (states[row.id] === 'running') await probe({ row, fresh: true })
    await keepRunning({ row }).catch((err: unknown) => log.error({ event: 'reconcile.failed', agent: row.id, error: messageOf(err) }))
  }
}

function requireModel(model: string | undefined): void {
  if (model) providerService.requireUsable({ key: model, param: 'model' })
}

const rowOf = (id: string): Promise<AgentRow> => findRow({ table: 'agent', id, missing: 'That agent doesn\'t exist. It may have been deleted.' })

async function tellAgent(id: string): Promise<void> {
  await apply.request(id).catch((err: unknown) => log.warn({ event: 'agent.reapply_failed', agent: id, error: messageOf(err) }))
}

async function ctxOf(row: AgentRow): Promise<Omit<AgentCtx, 'gateway'>> {
  const channels = await db.selectFrom('channel').selectAll().where('agent_id', '=', row.id).orderBy('kind').execute()
  const slots = resolveSlots({ model: row.model, catalog: providerService.catalog })
  return {
    agent: { ...row, slots }, token: agentToken({ id: row.id, epoch: row.token_epoch }), channelKey: unseal(row.channel_key),
    channels: channels.filter((channel) => channel.kind !== 'telegram' || channel.status === 'connected').map(renderedChannel), connections: await connectionService.reachable({ agent: row }),
    secrets: (await db.selectFrom('agent_secret').select(['name', 'hosts']).where('agent_id', '=', row.id).orderBy('name').execute()).map(({ name, hosts }) => ({ name, hosts: JSON.parse(hosts) as string[] })),
  }
}

function renderedChannel(channel: Selectable<Database['channel']>): RenderedChannel {
  const audience = audienceOf(channel)
  switch (channel.kind) {
    case 'whatsapp': return { kind: 'whatsapp', audience }
    case 'slack': return { kind: 'slack', audience }
    case 'telegram': return { kind: 'telegram', audience }
    case 'discord': return { kind: 'discord', audience }
  }
}

async function keepRunning({ row }: { row: AgentRow }): Promise<void> {
  const change = await put({ row })
  if (change !== 'none') log.info({ event: `reconcile.${change}`, agent: row.id })
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
const setupFailures = new Map<string, string>()

async function applied<T>(row: Pick<AgentRow, 'id'>, apply: Promise<T>): Promise<T> {
  try {
    const done = await apply
    setupFailures.delete(row.id)
    return done
  } catch (err) {
    setupFailures.set(row.id, messageOf(err))
    throw err
  }
}

async function healthOf({ row, state }: { row: AgentRow; state: string | undefined }): Promise<Health> {
  const failed = setupFailures.get(row.id)
  if (failed && row.wanted === 'running') return { health: 'setup_failed', detail: failed }
  const provider = splitModelKey(row.model)?.provider ?? 'claude'
  if (row.wanted === 'running' && config.modelMode === 'claude' && !providerService.connected(provider)) return { health: 'no_seat', detail: `${providerService.get({ id: provider }).name} isn't connected on this computer, so its model can't answer. Connect it under Settings › Models.` }
  if (state !== 'running') {
    probes.delete(row.id)
    return { health: null, detail: '' }
  }
  if (forward.gatewayFull(row.runs_on ?? HERE)) return { health: 'not_answering', detail: "This agent's computer has too many requests open, so new ones fail. Restart the computer if this lasts." }
  if (config.fakeAgents) return { health: 'answering', detail: '' }
  const last = await probe({ row, fresh: false })
  if (!last.detail) return { health: 'answering', detail: '' }
  return { health: last.detail === PORT_TAKEN || Date.now() - last.failingSince > STARTING_MS ? 'not_answering' : 'starting', detail: last.detail }
}

async function probe({ row, fresh }: { row: AgentRow; fresh: boolean }): Promise<Probe> {
  const last = probes.get(row.id)
  if (last && !fresh && Date.now() - last.at < PROBE_FRESH_MS) return last
  const detail = await forward.fetch({ agent: row, path: '/v1/models', init: { headers: { authorization: `Bearer ${unseal(row.channel_key)}` }, signal: AbortSignal.timeout(PROBE_MS) } })
    .then((res) => res.ok ? '' : res.status === 401 || res.status === 403 ? PORT_TAKEN : 'The agent returned an error.')
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
  const clean = [...name.replace(HIDDEN_CHARACTERS, '').trim()].slice(0, 40).join('').trim()
  if (!/[\p{L}\p{N}]/u.test(clean)) throw new HttpError(400, 'Give the agent a name with letters or digits.', { param: 'name' })
  return clean
}

export type AgentRow = Selectable<Database['agent']>
export type GatewayAgent = { id: string; owner_id: string; net: number }
export type AgentFacts = { id: string; workspace: string; owner: string; personal: boolean; by: string | null; value: AgentRecord; control: ControlRecord | null; row: AgentRow | undefined }
