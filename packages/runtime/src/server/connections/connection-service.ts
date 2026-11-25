import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import { SIGN_IN_KINDS, type Connection, type ConnectionKind, type ConnectionStatus, type ConnectionTool, type CreateConnection } from '@openhut/common/connections/connection.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, listen, log } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, unseal } from '../platform/secrets.ts'
import type { Connector, ConnectorContext, ToolSpec } from '../integrations/connector.ts'
import { convex } from '../integrations/convex/convex.ts'
import { excalidraw } from '../integrations/excalidraw/excalidraw.ts'
import { github } from '../integrations/github/github.ts'
import { google } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp } from '../integrations/mcp/mcp.ts'
import { postgres } from '../integrations/postgres/postgres.ts'
import type { Caller } from '../team/identity.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { providers } from '../models/providers/index.ts'
import { settings } from '../platform/settings.ts'
import { connectionRecords, type Secret } from './connection-records.ts'

const COLUMNS = ['id', 'kind', 'name', 'account', 'sign_in', 'owner_id', 'created_at'] as const
const MAX_REPLY = 64_000
const PER_AGENT_CONNECTION = 2
const TOOLS_FRESH_MS = 5 * 60_000
const running = new Map<string, number>()
const queues = new Map<string, Promise<unknown>>()
const toolCache = new Map<string, { at: number; tools: ToolSpec[] }>()
const redirectUrl = () => `${callbackBase()}/api/connection-authorizations/callback`
export const callbackBase = (): string => config.address
const CONNECTORS: Record<ConnectionKind, Connector> = {
  postgres: postgres.connector,
  convex: convex.connector,
  posthog: mcp.connector({ url: MCP_SERVERS.posthog, redirectUrl }),
  linear: mcp.connector({ url: MCP_SERVERS.linear, redirectUrl }),
  github: github.connector,
  excalidraw: excalidraw.connector,
  mcp: mcp.connector({ redirectUrl }),
  gmail: google.connector('gmail'),
  drive: google.connector('drive'),
  google: google.connector('google'),
  google_chat: google.connector('google_chat'),
  google_contacts: google.connector('google_contacts'),
  google_search: google.connector('google_search'),
}

listen((event) => {
  if (event.target?.type === 'connection') toolCache.delete(event.target.id)
})

export const connectionService = {
  redirectUrl,

  async reachable({ agent }: { agent: { id: string; owner_id: string } }): Promise<ReachableConnection[]> {
    return db.selectFrom('connection as c').innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.kind', 'c.name'])
      .where('g.agent_id', '=', agent.id).orderBy('c.created_at').execute()
  },

  async list({ actor }: { actor: Caller }): Promise<Connection[]> {
    const rows = await db.selectFrom('connection').select(COLUMNS).orderBy('created_at').execute()
    return connectionsOf({ rows })
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<Connection> {
    const [connection] = await connectionsOf({ rows: [await rowOf(id)] })
    return connection
  },

  async create({ actor, kind = 'postgres', name, dsn, deployKey, url, header }: { actor: Caller } & CreateConnection): Promise<Connection> {
    const { config, account } = await keyedConfig({ kind, dsn, deployKey, url, header })
    return connectionService.save({ actor, kind, name, config, account, signIn: false })
  },

  async save({ actor, kind, name, config, account, signIn, id }: { actor: Caller; kind: ConnectionKind; name: string; config: Secret; account: string; signIn: boolean; id?: string }): Promise<Connection> {
    if (id) {
      await connectionRecords.edit({ id, change: ({ value }) => ({ value: { ...value, account }, secret: config }) })
      emit({ name: 'connection.reconnected', actor, target: { type: 'connection', id, kind } })
      return connectionService.get({ actor, id })
    }
    const made = newId('cn')
    await connectionRecords.put({ id: made, value: { kind, name: name.trim().slice(0, 60) || kind, account, signIn, createdAt: new Date().toISOString() }, secret: config })
    emit({ name: 'connection.created', actor, target: { type: 'connection', id: made, kind } })
    return connectionService.get({ actor, id: made })
  },

  unsealed: (sealed: string): Record<string, unknown> => {
    const config: unknown = JSON.parse(unseal(sealed))
    return typeof config === 'object' && config !== null ? { ...config } : {}
  },

  async owned({ id }: { id: string }): Promise<Row & { config: string }> {
    return db.selectFrom('connection').select([...COLUMNS, 'config']).where('id', '=', (await rowOf(id)).id).executeTakeFirstOrThrow()
  },

  async delete({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'connection'>> {
    const row = await rowOf(id)
    await connectionRecords.remove(id)
    emit({ name: 'connection.deleted', actor, target: { type: 'connection', id, name: row.name } })
    return deleted({ id, object: 'connection' })
  },

  async wipe(): Promise<void> {
    await db.deleteFrom('connection').execute()
    for (const { id } of PROVIDERS) await settings.forgetProvider(id)
    toolCache.clear()
  },

  async rotatable(): Promise<{ id: string; kind: string; name: string }[]> {
    const rows = await db.selectFrom('connection').select(['id', 'kind', 'name']).orderBy('created_at').execute()
    const keyed = PROVIDERS.filter((info) => info.id !== 'claude' || settings.seatToken()).filter((info) => providers[info.id].connected())
    return [...rows, ...keyed.map((info) => ({ id: info.id, kind: 'provider', name: info.name }))]
  },

  async listTools({ actor, connectionId }: { actor: Caller; connectionId: string }): Promise<ConnectionTool[]> {
    const connection = await connectionService.get({ actor, id: connectionId })
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

async function keyedConfig({ kind, dsn, deployKey, url, header }: Omit<CreateConnection, 'name'>): Promise<{ config: Secret; account: string }> {
  if (kind === 'convex') {
    if (!deployKey) throw new HttpError(400, 'Paste the deploy key.', { param: 'deployKey' })
    return { config: { deployKey: deployKey.trim() }, account: await convex.probe(deployKey.trim()) }
  }
  if (kind === 'excalidraw') return { config: {}, account: excalidraw.account }
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

function withConnector<T>(connection: { id: string; kind: ConnectionKind }, fn: (ctx: ConnectorContext) => Promise<T>): Promise<T> {
  const work = async () => {
    const row = await db.selectFrom('connection').select('config').where('id', '=', connection.id).executeTakeFirstOrThrow()
    return fn({ config: JSON.parse(unseal(row.config)), refresh: (renew) => connectionRecords.refresh({ id: connection.id, renew }) })
  }
  if (!isSignIn(connection.kind)) return work()
  const next = (queues.get(connection.id) ?? Promise.resolve()).catch(() => undefined).then(work)
  queues.set(connection.id, next)
  return next.finally(() => { if (queues.get(connection.id) === next) queues.delete(connection.id) })
}

async function rowOf(id: string): Promise<Row> {
  const row = /^cn_[a-z0-9]{8,16}$/.test(id) ? await db.selectFrom('connection').select(COLUMNS).where('id', '=', id).executeTakeFirst() : undefined
  if (!row) throw new HttpError(404, 'That connection doesn\'t exist. It may have been deleted.')
  return row
}

async function connectionsOf({ rows }: { rows: Row[] }): Promise<Connection[]> {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const [owners, counts, successes, failures] = await Promise.all([
    db.selectFrom('person').select(['id', 'email']).where('id', 'in', rows.map((row) => row.owner_id)).execute(),
    db.selectFrom('connection_grant').select((eb) => ['connection_id', eb.fn.countAll<string>().as('n')]).where('connection_id', 'in', ids).groupBy('connection_id').execute(),
    db.selectFrom('connection_event').select((eb) => ['connection_id', eb.fn.max('at').as('at')]).where('connection_id', 'in', ids).where('outcome', '=', 'allowed').groupBy('connection_id').execute(),
    db.selectFrom('connection_event').select('connection_id').distinct().where('connection_id', 'in', ids).where('outcome', '=', 'failed').execute(),
  ])
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.email]))
  const agents = new Map(counts.map((count) => [count.connection_id, Number(count.n)]))
  const lastSuccess = new Map(successes.map((success) => [success.connection_id, success.at]))
  const failing = new Set(failures.map((failure) => failure.connection_id))
  return rows.map((row) => {
    const success = lastSuccess.get(row.id)
    return {
      id: row.id, object: 'connection', kind: row.kind, name: row.name, account: row.account, signIn: row.sign_in,
      ownerId: row.owner_id, ownerName: ownerName.get(row.owner_id) ?? 'someone',
      canDelete: true, agents: agents.get(row.id) ?? 0,
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
