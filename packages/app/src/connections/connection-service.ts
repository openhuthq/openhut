import type { Selectable } from 'kysely'
import type { Deleted } from '@fastmonkey/common/api.ts'
import { SIGN_IN_KINDS, type Connection, type ConnectionKind, type ConnectionStatus, type ConnectionTool, type CreateConnection } from '@fastmonkey/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { log, record } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, seal, unseal } from '../platform/secrets.ts'
import { publicUrl } from '../platform/settings.ts'
import type { Connector, ToolSpec } from '../integrations/connector.ts'
import { convex } from '../integrations/convex/convex.ts'
import { github } from '../integrations/github/github.ts'
import { google } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp } from '../integrations/mcp/mcp.ts'
import { postgres } from '../integrations/postgres/postgres.ts'
import { isAdmin, type Caller } from '../team/identity.ts'

const COLUMNS = ['id', 'kind', 'name', 'account', 'sign_in', 'owner_id', 'everyone', 'created_at'] as const
const MAX_REPLY = 64_000
const PER_AGENT_CONNECTION = 2
const TOOLS_FRESH_MS = 5 * 60_000
const running = new Map<string, number>()
const queues = new Map<string, Promise<unknown>>()
const toolCache = new Map<string, { at: number; tools: ToolSpec[] }>()
const redirectUrl = () => `${publicUrl()}/api/connection-authorizations/callback`
const CONNECTORS: Record<ConnectionKind, Connector> = {
  postgres: postgres.connector,
  convex: convex.connector,
  posthog: mcp.connector({ url: MCP_SERVERS.posthog, redirectUrl }),
  linear: mcp.connector({ url: MCP_SERVERS.linear, redirectUrl }),
  github: github.connector,
  mcp: mcp.connector({ redirectUrl }),
  gmail: google.connector('gmail'),
  drive: google.connector('drive'),
  google: google.connector('google'),
}

export const connectionService = {
  redirectUrl,

  async canUse({ personId, connectionId }: { personId: string; connectionId: string }): Promise<boolean> {
    return !!(await usableBy(personId).select('c.id').where('c.id', '=', connectionId).executeTakeFirst())
  },

  async reachable({ agent }: { agent: { id: string; owner_id: string } }): Promise<ReachableConnection[]> {
    return usableBy(agent.owner_id).innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.kind', 'c.name'])
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

  async create({ actor, kind = 'postgres', name, dsn, deployKey, url, header }: { actor: Caller } & CreateConnection): Promise<Connection> {
    const { config, account } = await keyedConfig({ kind, dsn, deployKey, url, header })
    return connectionService.save({ actor, kind, name, config, account, signIn: false })
  },

  async save({ actor, kind, name, config, account, signIn, id }: { actor: Caller; kind: ConnectionKind; name: string; config: unknown; account: string; signIn: boolean; id?: string }): Promise<Connection> {
    const sealed = seal(JSON.stringify(config))
    if (id) {
      await db.updateTable('connection').set({ config: sealed, account }).where('id', '=', id).execute()
      toolCache.delete(id)
      record({ action: 'connection.reconnected', actor, target: { type: 'connection', id, kind } })
      return connectionService.get({ actor, id })
    }
    const row = await db.insertInto('connection')
      .values({ id: newId('cn'), kind, name: name.trim().slice(0, 60) || kind, account, sign_in: signIn, owner_id: actor.id, config: sealed })
      .returning('id').executeTakeFirstOrThrow()
    record({ action: 'connection.created', actor, target: { type: 'connection', id: row.id, kind } })
    return connectionService.get({ actor, id: row.id })
  },

  unsealed: (sealed: string): Record<string, unknown> => {
    const config: unknown = JSON.parse(unseal(sealed))
    return typeof config === 'object' && config !== null ? { ...config } : {}
  },

  async owned({ actor, id }: { actor: Caller; id: string }): Promise<Row & { config: string }> {
    const row = await db.selectFrom('connection').select([...COLUMNS, 'config']).where('id', '=', (await rowOf(id)).id).executeTakeFirstOrThrow()
    if (row.owner_id !== actor.id) throw new HttpError(403, 'Only the person who connected it can reconnect it.')
    return row
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
    toolCache.delete(id)
    record({ action: 'connection.deleted', actor, target: { type: 'connection', id, name: row.name } })
    return deleted({ id, object: 'connection' })
  },

  async listTools({ actor, connectionId }: { actor: Caller; connectionId: string }): Promise<ConnectionTool[]> {
    const connection = await connectionService.get({ actor, id: connectionId })
    if (!connection.usable) throw new HttpError(403, `Only people who can use ${connection.name} see its tools. Ask ${connection.ownerName} to share it.`)
    const tools = await toolsOf({ id: connection.id, kind: connection.kind }).catch((err: unknown) => {
      throw new HttpError(502, `${connection.name} didn't list its tools: ${messageOf(err)}`)
    })
    return tools.map((tool) => ({ object: 'connection_tool', name: `${connection.kind}_${tool.name}`, description: tool.description }))
  },

  async tools({ agent }: { agent: { id: string; owner_id: string } }): Promise<AgentTool[]> {
    const connections = await connectionService.reachable({ agent })
    const lists = await Promise.all(connections.map(async (connection) => {
      const tools = await toolsOf(connection).catch((err: unknown) => {
        log.warn({ event: 'connection.tools_failed', connection: connection.id, error: messageOf(err) })
        return []
      })
      return tools.map((spec) => ({ name: `${connection.kind}_${spec.name}`, connection, spec }))
    }))
    return lists.flat()
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
    const key = `${agent.id}:${connection.id}`
    const inFlight = running.get(key) ?? 0
    if (inFlight >= PER_AGENT_CONNECTION) {
      await recordCall('failed', connection.id)
      return { text: `Busy: ${inFlight} calls to this connection are already running for this agent. Wait for them to finish.`, isError: true }
    }
    running.set(key, inFlight + 1)
    try {
      const result = await withConnector(connection, (ctx) => CONNECTORS[connection.kind].call({ ...ctx, tool: spec.name, args }))
      if (result.text.length > MAX_REPLY) throw new Error(`Result too large for the agent (${Math.round(result.text.length / 1024)} KB, the limit is 64 KB). Ask for less.`)
      await recordCall(result.isError ? 'failed' : 'allowed', connection.id)
      return { text: result.text, isError: result.isError }
    } catch (err) {
      await recordCall('failed', connection.id)
      return { text: `Failed: ${messageOf(err)}`.slice(0, 2000), isError: true }
    } finally {
      running.set(key, (running.get(key) ?? 1) - 1)
    }
  },
}

async function keyedConfig({ kind, dsn, deployKey, url, header }: Omit<CreateConnection, 'name'>): Promise<{ config: unknown; account: string }> {
  if (kind === 'convex') {
    if (!deployKey) throw new HttpError(400, 'Paste the deploy key.', { param: 'deployKey' })
    return { config: { deployKey: deployKey.trim() }, account: await convex.probe(deployKey.trim()) }
  }
  if (kind === 'mcp') {
    if (!url) throw new HttpError(400, 'Paste the MCP server URL.', { param: 'url' })
    const headers = mcp.parseHeader(header)
    const tools = await mcp.probe({ url, headers }).catch((err: unknown) => {
      throw new HttpError(400, `${new URL(url).host} didn't answer as an MCP server: ${messageOf(err)}. If it needs a sign-in, choose Sign in instead.`, { param: 'url' })
    })
    return { config: { url, headers }, account: `${new URL(url).host} · ${tools} tools` }
  }
  if (!dsn) throw new HttpError(400, 'Paste a postgres:// connection string.', { param: 'dsn' })
  return { config: { dsn }, account: postgres.account(dsn) }
}

async function toolsOf(connection: { id: string; kind: ConnectionKind }): Promise<ToolSpec[]> {
  const cached = toolCache.get(connection.id)
  if (cached && Date.now() - cached.at < TOOLS_FRESH_MS) return cached.tools
  const tools = await withConnector(connection, (ctx) => CONNECTORS[connection.kind].tools(ctx))
  toolCache.set(connection.id, { at: Date.now(), tools })
  return tools
}

function withConnector<T>(connection: { id: string; kind: ConnectionKind }, fn: (ctx: { config: unknown; save: (config: unknown) => Promise<void> }) => Promise<T>): Promise<T> {
  const work = async () => {
    const row = await db.selectFrom('connection').select('config').where('id', '=', connection.id).executeTakeFirstOrThrow()
    return fn({ config: JSON.parse(unseal(row.config)), save: async (config) => { await db.updateTable('connection').set({ config: seal(JSON.stringify(config)) }).where('id', '=', connection.id).execute() } })
  }
  if (!isSignIn(connection.kind)) return work()
  const next = (queues.get(connection.id) ?? Promise.resolve()).catch(() => undefined).then(work)
  queues.set(connection.id, next)
  return next.finally(() => { if (queues.get(connection.id) === next) queues.delete(connection.id) })
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
      id: row.id, object: 'connection', kind: row.kind, name: row.name, account: row.account, signIn: row.sign_in,
      ownerId: row.owner_id, ownerName: ownerName.get(row.owner_id) ?? 'someone',
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

const isSignIn = (kind: ConnectionKind): boolean => (SIGN_IN_KINDS as readonly string[]).includes(kind)

export type ReachableConnection = { id: string; kind: ConnectionKind; name: string }
export type AgentTool = { name: string; connection: ReachableConnection; spec: ToolSpec }

type Row = Pick<Selectable<Database['connection']>, (typeof COLUMNS)[number]>
