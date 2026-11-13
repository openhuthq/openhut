import type { Selectable } from 'kysely'
import * as z from 'zod/mini'
import type { Deleted } from '@fastmonkey/common/api.ts'
import type { Connection, ConnectionStatus } from '@fastmonkey/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { record } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { describeIssues } from '../platform/validation.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import { postgres, type ConnectorTool } from '../integrations/postgres/postgres.ts'
import { isAdmin, type Caller } from '../team/identity.ts'

const CONNECTORS: Record<Connection['kind'], Record<string, ConnectorTool>> = { postgres: postgres.tools }
const COLUMNS = ['id', 'kind', 'name', 'owner_id', 'everyone', 'created_at'] as const
const MAX_REPLY = 64_000
const PER_AGENT_CONNECTION = 2
const running = new Map<string, number>()
const ConnectionConfig = z.object({ dsn: z.string() })

export const connectionService = {
  async canUse({ personId, connectionId }: { personId: string; connectionId: string }): Promise<boolean> {
    return !!(await usableBy(personId).select('c.id').where('c.id', '=', connectionId).executeTakeFirst())
  },

  async reachable({ agent }: { agent: { id: string; owner_id: string } }): Promise<ReachableConnection[]> {
    return usableBy(agent.owner_id).innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.kind', 'c.name', 'c.config'])
      .where('g.agent_id', '=', agent.id).orderBy('c.created_at').execute()
  },

  async list({ actor }: { actor: Caller }): Promise<Connection[]> {
    const rows = await db.selectFrom('connection').select(COLUMNS).orderBy('created_at').execute()
    return connectionsOf({ actor, rows })
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Connection> {
    const [connection] = await connectionsOf({ actor, rows: [await rowOf(id)] })
    return connection
  },

  async create({ actor, name, dsn }: { actor: Caller; name: string; dsn: string }): Promise<Connection> {
    postgres.parseDsn(dsn)
    const row = await db.insertInto('connection')
      .values({ id: newId('cn'), kind: 'postgres', name: name.trim().slice(0, 60) || 'postgres', owner_id: actor.id, config: seal(JSON.stringify({ dsn })) })
      .returning(COLUMNS).executeTakeFirstOrThrow()
    record({ action: 'connection.created', actor, target: { type: 'connection', id: row.id, name: row.name } })
    return connectionService.get({ actor, id: row.id })
  },

  async update({ actor, id, everyone }: { actor: Caller; id: string; everyone: boolean }): Promise<Connection> {
    const row = await rowOf(id)
    if (row.owner_id !== actor.id) throw new HttpError(403, 'Only its owner can share a connection.')
    await db.updateTable('connection').set({ everyone }).where('id', '=', id).execute()
    record({ action: 'connection.shared', actor, target: { type: 'connection', id, everyone } })
    return connectionService.get({ actor, id })
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'connection'>> {
    const row = await rowOf(id)
    if (row.owner_id !== actor.id && !isAdmin(actor)) throw new HttpError(403, 'Only its owner or an admin can delete a connection.')
    await db.deleteFrom('connection').where('id', '=', id).execute()
    record({ action: 'connection.deleted', actor, target: { type: 'connection', id, name: row.name } })
    return deleted({ id, object: 'connection' })
  },

  async tools({ agent }: { agent: { id: string; owner_id: string } }): Promise<AgentTool[]> {
    const connections = await connectionService.reachable({ agent })
    return connections.flatMap((connection) => Object.entries(CONNECTORS[connection.kind]).map(([tool, spec]) => ({ name: `${connection.kind}_${tool}`, connection, spec })))
  },

  async call({ agent, name, args, connectionId, reason }: { agent: { id: string; owner_id: string }; name: string; args: Record<string, unknown>; connectionId?: string; reason: string }): Promise<{ text: string; isError: boolean }> {
    const started = Date.now()
    const recordCall = (outcome: 'allowed' | 'denied' | 'failed', id: string | null) =>
      db.insertInto('connection_event').values({ agent_id: agent.id, connection_id: id, tool: name, reason: reason.slice(0, 500), outcome, ms: Date.now() - started }).execute()
    const matches = (await connectionService.tools({ agent })).filter((tool) => tool.name === name && (!connectionId || tool.connection.id === connectionId))
    if (!matches.length) {
      await recordCall('denied', connectionId ?? null)
      return { text: `Denied: no connection grants ${name} to this agent.`, isError: true }
    }
    if (matches.length > 1) {
      await recordCall('failed', null)
      return { text: `More than one connection has ${name}; pass connectionId (${matches.map((m) => m.connection.id).join(', ')}).`, isError: true }
    }
    const [{ connection, spec }] = matches
    const parsed = z.safeParse(spec.input, args)
    if (!parsed.success) {
      await recordCall('failed', connection.id)
      return { text: `${argumentProblem(parsed.error.issues)}. Call describe_tool to see what ${name} takes.`, isError: true }
    }
    const key = `${agent.id}:${connection.id}`
    const inFlight = running.get(key) ?? 0
    if (inFlight >= PER_AGENT_CONNECTION) {
      await recordCall('failed', connection.id)
      return { text: `Busy: ${inFlight} calls to this connection are already running for this agent. Wait for them to finish.`, isError: true }
    }
    running.set(key, inFlight + 1)
    try {
      const out = JSON.stringify(await spec.run({ dsn: ConnectionConfig.parse(JSON.parse(unseal(connection.config))).dsn, args }))
      if (out.length > MAX_REPLY) throw new Error(`Result too large for the agent (${Math.round(out.length / 1024)} KB, the limit is 64 KB). Select fewer rows or columns.`)
      await recordCall('allowed', connection.id)
      return { text: out, isError: false }
    } catch (err) {
      await recordCall('failed', connection.id)
      return { text: `Failed: ${messageOf(err)}`.slice(0, 2000), isError: true }
    } finally {
      running.set(key, (running.get(key) ?? 1) - 1)
    }
  },
}

function usableBy(personId: string) {
  return db.selectFrom('connection as c').innerJoin('person as p', (join) => join.on('p.id', '=', personId).on('p.removed_at', 'is', null))
    .where((eb) => eb.or([eb('c.owner_id', '=', personId), eb('c.everyone', '=', true)]))
}

async function rowOf(id: string): Promise<Row> {
  const row = /^cn_[a-z0-9]{8}$/.test(id) ? await db.selectFrom('connection').select(COLUMNS).where('id', '=', id).executeTakeFirst() : undefined
  if (!row) throw new HttpError(404, 'That connection doesn\'t exist. It may have been deleted.')
  return row
}

async function connectionsOf({ actor, rows }: { actor: Caller; rows: Row[] }): Promise<Connection[]> {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const [owners, counts, usable, successes, failures] = await Promise.all([
    db.selectFrom('person').select(['id', 'email']).where('id', 'in', rows.map((row) => row.owner_id)).execute(),
    db.selectFrom('connection_grant').select((eb) => ['connection_id', eb.fn.countAll<string>().as('n')]).where('connection_id', 'in', ids).groupBy('connection_id').execute(),
    usableBy(actor.id).select('c.id').where('c.id', 'in', ids).execute(),
    db.selectFrom('connection_event').select((eb) => ['connection_id', eb.fn.max('at').as('at')]).where('connection_id', 'in', ids).where('outcome', '=', 'allowed').groupBy('connection_id').execute(),
    db.selectFrom('connection_event').select('connection_id').distinct().where('connection_id', 'in', ids).where('outcome', '=', 'failed').execute(),
  ])
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.email]))
  const agents = new Map(counts.map((count) => [count.connection_id, Number(count.n)]))
  const canUse = new Set(usable.map((connection) => connection.id))
  const lastSuccess = new Map(successes.map((success) => [success.connection_id, success.at]))
  const failing = new Set(failures.map((failure) => failure.connection_id))
  return rows.map((row) => {
    const success = lastSuccess.get(row.id)
    return {
      id: row.id, object: 'connection', kind: row.kind, name: row.name, ownerId: row.owner_id, ownerName: ownerName.get(row.owner_id) ?? 'someone',
      everyone: row.everyone, usable: canUse.has(row.id), canDelete: row.owner_id === actor.id || isAdmin(actor), agents: agents.get(row.id) ?? 0,
      status: statusOf({ succeeded: !!success, failed: failing.has(row.id) }), lastSuccessAt: success ? new Date(success).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
    }
  })
}

function statusOf({ succeeded, failed }: { succeeded: boolean; failed: boolean }): ConnectionStatus {
  if (succeeded) return 'connected'
  if (failed) return 'failing'
  return 'no_calls'
}

function argumentProblem(issues: z.core.$ZodIssue[]): string {
  const unknown = issues.flatMap((issue) => issue.code === 'unrecognized_keys' ? issue.keys : [])
  return unknown.length ? `Unknown arguments: ${unknown.join(', ')}` : `Invalid arguments: ${describeIssues(issues)}`
}

export type ReachableConnection = { id: string; kind: Connection['kind']; name: string; config: string }
export type AgentTool = { name: string; connection: ReachableConnection; spec: ConnectorTool }

type Row = Pick<Selectable<Database['connection']>, (typeof COLUMNS)[number]>
