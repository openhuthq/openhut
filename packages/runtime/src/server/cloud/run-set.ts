import { randomBytes } from 'node:crypto'
import { AgentRecord, ControlRecord } from '@openhut/common/agents/agent.ts'
import { agentService, type AgentRow } from '../agents/agent-service.ts'
import { memoryService } from '../agents/memory-service.ts'
import { skillService } from '../agents/skill-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { routineService } from '../routines/routine-service.ts'
import { agentd } from '../platform/agentd.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { portsFree } from '../platform/network.ts'
import { newId, seal } from '../platform/secrets.ts'
import { keysService } from './keys-service.ts'
import { recordsService, type Change, type Held } from './records.ts'
import { roomKeys } from './room-keys.ts'
import { upgrade } from './upgrade.ts'

const MAX_AGENTS = 250
const START_MS = 5_000
const AGENT_KINDS = new Set(['agent', 'control', 'memory'])
const CHILD_KINDS = new Set(['skill', 'routine', 'channel'])

let queue: Promise<void> = Promise.resolve()
let watching: (() => void) | undefined

export const runSet = {
  async start(): Promise<void> {
    runSet.watch()
    const done = runSet.refresh().catch((err: unknown) => log.warn({ event: 'run_set.refresh_failed', error: messageOf(err) }))
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, START_MS).unref())])
  },

  watch(): void {
    watching ??= recordsService.onChange((change) => void heard(change))
  },

  refresh: (): Promise<void> => serial(refreshOnce),

  apply: ({ workspace, id }: { workspace: string; id: string }): Promise<void> => serial(() => applyOne({ workspace, id })),

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
  if (!keysService.account()) return
  const id = CHILD_KINDS.has(change.collection) ? (await recordsService.get({ collection: change.collection, workspace: change.workspace, id: change.id }).catch(() => null))?.parent : AGENT_KINDS.has(change.collection) ? change.id : undefined
  if (!id) return
  if (change.collection !== 'agent' && change.collection !== 'control' && !await db.selectFrom('agent').select('id').where('id', '=', id).executeTakeFirst()) return
  await runSet.apply({ workspace: change.workspace, id }).catch((err: unknown) => log.warn({ event: 'run_set.apply_failed', agent: id, error: messageOf(err) }))
}

async function refreshOnce(): Promise<void> {
  if (!keysService.account() || !keysService.session()) return
  await upgrade.run()
  const me = await keysService.deviceKey()
  const kept = new Set<string>()
  for (const room of roomKeys.rooms()) {
    const workspace = room.workspace.id
    const [agents, controls] = await Promise.all([recordsService.list({ collection: 'agent', workspace }), recordsService.list({ collection: 'control', workspace })])
    const control = new Map(controls.map((each) => [each.id, each]))
    await ownAgain({ workspace, agents })
    for (const agent of agents) {
      const placed = control.get(agent.id)
      if (ControlRecord.safeParse(placed?.value).data?.runsOn !== me || !placed) continue
      kept.add(agent.id)
      await keep({ agent, control: placed }).catch((err: unknown) => log.warn({ event: 'run_set.apply_failed', agent: agent.id, error: messageOf(err) }))
    }
  }
  const home = keysService.signedIn().workspace.id
  for (const row of await db.selectFrom('agent').select(['id', 'workspace']).execute()) {
    if (!kept.has(row.id)) await applyOne({ workspace: row.workspace ?? home, id: row.id })
  }
}

async function ownAgain({ workspace, agents }: { workspace: string; agents: Held[] }): Promise<void> {
  const email = keysService.signedIn().email
  const mine = roomKeys.members(workspace)?.members.find((member) => member.email === email)?.devices ?? []
  for (const agent of agents.filter((each) => each.parent === email && !each.deleted && !mine.includes(each.by))) {
    await recordsService.put({ collection: 'agent', id: agent.id, workspace, parent: email, personal: agent.personal, value: agent.value, reapply: (latest) => ({ value: latest.value }) })
      .catch((err: unknown) => log.warn({ event: 'run_set.resign_failed', agent: agent.id, error: messageOf(err) }))
  }
}

async function applyOne({ workspace, id }: { workspace: string; id: string }): Promise<void> {
  const row = await db.selectFrom('agent').selectAll().where('id', '=', id).executeTakeFirst()
  if (!roomKeys.room(workspace)) return row ? leave(row) : undefined
  const [agent, control] = await Promise.all([recordsService.get({ collection: 'agent', workspace, id }), recordsService.get({ collection: 'control', workspace, id })])
  const runsOn = ControlRecord.safeParse(control?.value).data?.runsOn
  const me = await keysService.deviceKey()
  if (agent && !agent.deleted && control && runsOn === me) return keep({ agent, control })
  if (row && (agent?.deleted || control?.deleted || (runsOn !== undefined && runsOn !== me))) await leave(row)
}

async function keep({ agent, control }: { agent: Held; control: Held }): Promise<void> {
  const value = AgentRecord.parse(agent.value)
  const placed = ControlRecord.parse(control.value)
  const home = keysService.signedIn().workspace.id
  const fields = {
    name: value.name, instructions: value.instructions, face: value.face, wanted: value.wanted, model: placed.model, code_execution: placed.codeExecution, web_browser: placed.browser,
    runs_on: placed.runsOn, workspace: agent.workspace === home ? null : agent.workspace, shared: !agent.personal, people: JSON.stringify(placed.people), owner: agent.parent ?? null,
  }
  const row = await db.selectFrom('agent').select('id').where('id', '=', agent.id).executeTakeFirst()
  if (row) await db.updateTable('agent').set(fields).where('id', '=', agent.id).execute()
  else await db.insertInto('agent').values({ id: agent.id, ...fields, owner_id: await ownerId(), net: await freeNet(), channel_key: seal(randomBytes(24).toString('hex')), created_at: value.createdAt }).execute()
  await grantsOf({ agentId: agent.id, connections: placed.grants.map((grant) => grant.connection) })
  const children = async (collection: 'channel' | 'routine' | 'skill') => recordsService.list({ collection, workspace: agent.workspace, parent: agent.id })
  const [channels, routines, skills, memory] = await Promise.all([children('channel'), children('routine'), children('skill'), recordsService.get({ collection: 'memory', workspace: agent.workspace, id: agent.id })])
  const greet = await channelService.applyRecords({ agentId: agent.id, records: channels })
  await routineService.applyRecords({ agentId: agent.id, records: routines })
  await agentService.reapply({ id: agent.id })
  await memoryService.applyRecord({ agentId: agent.id, record: memory && !memory.deleted ? memory : null })
  await skillService.applyRecords({ agentId: agent.id, records: skills })
  await greet()
  if (!row) emit({ name: 'agent.synced', target: { type: 'agent', id: agent.id } })
}

async function leave(row: Pick<AgentRow, 'id'>): Promise<void> {
  await agentd.remove({ id: row.id, trash: true }).catch((err: unknown) => log.warn({ event: 'agent.remove_failed', agent: row.id, error: messageOf(err) }))
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
  await db.insertInto('person').values({ id: newId('usr'), email: keysService.signedIn().email, role: 'owner', removed_at: null }).onConflict((oc) => oc.doNothing()).execute()
  return (await db.selectFrom('person').select('id').where('role', '=', 'owner').executeTakeFirstOrThrow()).id
}

async function freeNet(): Promise<number> {
  const used = new Set((await db.selectFrom('agent').select('net').execute()).map((row) => row.net))
  for (let net = 1; net <= MAX_AGENTS; net++) if (!used.has(net) && await portsFree(net)) return net
  throw new HttpError(409, `This computer already runs ${MAX_AGENTS} agents. Run some on another computer first.`)
}
