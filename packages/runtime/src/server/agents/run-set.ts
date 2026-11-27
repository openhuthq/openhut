import { randomBytes } from 'node:crypto'
import { AgentRecord, ControlRecord } from '@openhut/common/agents/agent.ts'
import { agentService, type AgentRow } from './agent-service.ts'
import { memoryService } from './memory-service.ts'
import { skillService } from './skill-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { routineService } from '../inbox/routines.ts'
import { agent } from '../../core/agent.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { portsFree } from '../platform/network.ts'
import { newId, seal } from '../platform/secrets.ts'
import { recordsService, type Change, type Held } from '../platform/records.ts'
import { HOME } from '../team/home.ts'
import { apply } from './apply.ts'

const MAX_AGENTS = 250
const START_MS = 5_000
const AGENT_KINDS = new Set(['agent', 'control', 'memory'])
const CHILD_KINDS = new Set(['skill', 'routine', 'channel'])

let queue: Promise<void> = Promise.resolve()
let watching: (() => void) | undefined
const greetings = new Map<string, () => Promise<void>>()

export const runSet = {
  async start(): Promise<void> {
    runSet.watch()
    const done = runSet.refresh().catch((err: unknown) => log.warn({ event: 'run_set.refresh_failed', error: messageOf(err) }))
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, START_MS).unref())])
  },

  watch(): void {
    apply.use((id) => settle(id))
    watching ??= recordsService.onChange((change) => heard(change))
  },

  refresh: (): Promise<void> => serial(refreshOnce),

  project: ({ workspace, id }: { workspace: string; id: string }): Promise<void> => serial(() => project({ workspace, id })),

  settle: (id: string): Promise<void> => settle(id),

  async afterTurn({ agentId }: { agentId: string }): Promise<void> {
    await memoryService.backUp({ agentId }).catch((err: unknown) => log.warn({ event: 'memory.backup_failed', agent: agentId, error: messageOf(err) }))
    await skillService.backUp({ agentId }).catch((err: unknown) => log.warn({ event: 'skill.backup_failed', agent: agentId, error: messageOf(err) }))
  },
}

function serial(step: () => Promise<void>): Promise<void> {
  const next = queue.then(step)
  queue = next.catch(() => undefined)
  return next
}

async function heard(change: Change): Promise<void> {
  const id = CHILD_KINDS.has(change.collection) ? (await recordsService.get({ collection: change.collection, workspace: change.workspace, id: change.id }).catch(() => null))?.parent : AGENT_KINDS.has(change.collection) ? change.id : undefined
  if (!id) return
  if (change.collection !== 'agent' && change.collection !== 'control' && !await db.selectFrom('agent').select('id').where('id', '=', id).executeTakeFirst()) return
  await runSet.project({ workspace: change.workspace, id })
    .then(() => change.backup ? undefined : apply.request(id))
    .catch((err: unknown) => log.warn({ event: 'run_set.apply_failed', agent: id, error: messageOf(err) }))
}

async function refreshOnce(): Promise<void> {
  const ids = new Set<string>()
  for (const agent of await recordsService.list({ collection: 'agent', workspace: HOME })) {
    await project({ workspace: HOME, id: agent.id }).catch((err: unknown) => log.warn({ event: 'run_set.apply_failed', agent: agent.id, error: messageOf(err) }))
    ids.add(agent.id)
  }
  for (const row of await db.selectFrom('agent').select('id').execute()) ids.add(row.id)
  for (const id of ids) await apply.request(id).catch((err: unknown) => log.warn({ event: 'run_set.apply_failed', agent: id, error: messageOf(err) }))
}

async function project({ workspace, id }: { workspace: string; id: string }): Promise<void> {
  if (workspace !== HOME) return
  const [agent, control] = await Promise.all([recordsService.get({ collection: 'agent', workspace, id }), recordsService.get({ collection: 'control', workspace, id })])
  if (agent && control && placeable({ agent, control })) await keep({ agent, control })
}

async function settle(id: string): Promise<void> {
  const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) return
  const workspace = row.workspace ?? HOME
  const [agent, control] = await Promise.all([recordsService.get({ collection: 'agent', workspace, id }), recordsService.get({ collection: 'control', workspace, id })])
  if (workspace !== HOME || !agent || !control || !placeable({ agent, control })) {
    if (workspace !== HOME || agent?.deleted || control?.deleted) await leave(row)
    return
  }
  const children = async (collection: 'skill') => recordsService.list({ collection, workspace, parent: id })
  const [skills, memory] = await Promise.all([children('skill'), recordsService.get({ collection: 'memory', workspace, id })])
  await agentService.reapply({ id })
  await memoryService.applyRecord({ agentId: id, record: memory && !memory.deleted ? memory : null })
  await skillService.applyRecords({ agentId: id, records: skills })
  const greet = greetings.get(id)
  greetings.delete(id)
  await greet?.()
}

function placeable({ agent, control }: { agent: Held; control: Held }): boolean {
  return !agent.deleted && !control.deleted && AgentRecord.safeParse(agent.value).success && ControlRecord.safeParse(control.value).success
}

async function keep({ agent, control }: { agent: Held; control: Held }): Promise<void> {
  const value = AgentRecord.parse(agent.value)
  const placed = ControlRecord.parse(control.value)
  const fields = {
    name: value.name, instructions: value.instructions, face: value.face, wanted: value.wanted, model: placed.model, code_execution: placed.codeExecution, web_browser: placed.browser,
    runs_on: placed.runsOn, workspace: agent.workspace === HOME ? null : agent.workspace, shared: !agent.personal, people: JSON.stringify(placed.people), owner: agent.parent ?? null,
  }
  const row = await db.selectFrom('agent').select('id').where('id', '=', agent.id).executeTakeFirst()
  if (row) await db.updateTable('agent').set(fields).where('id', '=', agent.id).execute()
  else await db.insertInto('agent').values({ id: agent.id, ...fields, owner_id: await ownerId(), net: await freeNet(), channel_key: seal(randomBytes(24).toString('hex')), created_at: value.createdAt }).execute()
  await grantsOf({ agentId: agent.id, connections: placed.grants.map((grant) => grant.connection) })
  const children = async (collection: 'channel' | 'routine') => recordsService.list({ collection, workspace: agent.workspace, parent: agent.id })
  const [channels, routines] = await Promise.all([children('channel'), children('routine')])
  const greet = await channelService.applyRecords({ agentId: agent.id, records: channels })
  const before = greetings.get(agent.id)
  greetings.set(agent.id, async () => { await before?.(); await greet() })
  await routineService.applyRecords({ agentId: agent.id, records: routines })
  if (!row) emit({ name: 'agent.synced', target: { type: 'agent', id: agent.id } })
}

async function leave(row: Pick<AgentRow, 'id'>): Promise<void> {
  await agent.remove(row.id, { keep: true }).catch((err: unknown) => log.warn({ event: 'agent.remove_failed', agent: row.id, error: messageOf(err) }))
  await db.deleteFrom('agent').where('id', '=', row.id).execute()
  emit({ name: 'agent.synced', target: { type: 'agent', id: row.id } })
}

async function grantsOf({ agentId, connections }: { agentId: string; connections: string[] }): Promise<void> {
  const present = connections.length ? (await db.selectFrom('connection').select('id').where('id', 'in', connections).execute()).map((row) => row.id) : []
  let gone = db.deleteFrom('connection_grant').where('agent_id', '=', agentId)
  if (present.length) gone = gone.where('connection_id', 'not in', present)
  await gone.execute()
  for (const connection of present) {
    await db.insertInto('connection_grant').values({ id: newId('gr'), agent_id: agentId, connection_id: connection }).onConflict((oc) => oc.columns(['connection_id', 'agent_id']).doNothing()).execute()
  }
}

async function ownerId(): Promise<string> {
  const found = await db.selectFrom('person').select('id').where('role', '=', 'owner').executeTakeFirst()
  if (found) return found.id
  throw new HttpError(409, 'This install has no owner yet.')
}

async function freeNet(): Promise<number> {
  const used = new Set((await db.selectFrom('agent').select('net').execute()).map((row) => row.net))
  for (let net = 1; net <= MAX_AGENTS; net++) if (!used.has(net) && await portsFree(net)) return net
  throw new HttpError(409, `This computer already runs ${MAX_AGENTS} agents. Run some on another computer first.`)
}

runSet.watch()
