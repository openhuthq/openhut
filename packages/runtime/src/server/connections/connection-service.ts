import { sql, type Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import { KEYED_KINDS, SIGN_IN_KINDS, type Connection, type ConnectionKind, type ConnectionStatus, type ConnectionTool, type CreateConnection, type ReconnectConnection } from '@openhut/common/connections/connection.ts'
import { config } from '../platform/config.ts'
import { publicAddress } from '../platform/address.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit, listen, log } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { newId, unseal } from '../platform/secrets.ts'
import type { Connector, ConnectorContext, ToolSpec } from '../integrations/connector.ts'
import { convex } from '../integrations/convex/convex.ts'
import { github } from '../integrations/github/github.ts'
import { google } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp } from '../integrations/mcp/mcp.ts'
import { postgres } from '../integrations/postgres/postgres.ts'
import type { Caller } from '../team/identity.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { providers } from '../models/providers/index.ts'
import { settings } from '../platform/settings.ts'
import { connectionRecords, type Secret } from './connection-records.ts'
import { redact } from './redact.ts'
import { permissions } from '../permissions/permissions.ts'
import { asks } from '../../core/asks.ts'
import { routineService } from '../inbox/routines.ts'
import { plugins } from '../../core/plugins.ts'
import { labelOf } from '../threads/work.ts'

const COLUMNS = ['id', 'kind', 'name', 'account', 'sign_in', 'owner_id', 'created_at'] as const
const MAX_REPLY = 64_000
const PER_AGENT_CONNECTION = 2
const TOOLS_FRESH_MS = 5 * 60_000
const running = new Map<string, number>()
const queues = new Map<string, Promise<unknown>>()
const DISCOVERY = /schema|describe|find|search/i
const toolCache = new Map<string, { at: number; tools: ToolSpec[] }>()
const actionCache = new Map<string, Map<string, ToolSpec>>()
const JOURNAL = 100
const ASK_EXPIRES_MS = 30 * 60_000
const JOURNAL_TEXT = 4000
const journal = new Map<string, AppCall[]>()
const redirectUrl = () => `${callbackBase()}/api/connection-authorizations/callback`
export const callbackBase = (): string => publicAddress()
const CONNECTORS: Record<ConnectionKind, Connector> = {
  postgres: postgres.connector,
  convex: convex.connector,
  posthog: mcp.connector({ url: MCP_SERVERS.posthog, redirectUrl }),
  linear: mcp.connector({ url: MCP_SERVERS.linear, redirectUrl }),
  github: github.connector,
  // create_view only draws an inline widget the app doesn't render; agents use export_to_excalidraw for a link.
  excalidraw: mcp.connector({ url: MCP_SERVERS.excalidraw, redirectUrl, hide: ['create_view'] }),
  mcp: mcp.connector({ redirectUrl }),
  gmail: google.connector('gmail'),
  drive: google.connector('drive'),
  google: google.connector('google'),
  google_chat: google.connector('google_chat'),
  google_contacts: google.connector('google_contacts'),
  google_search: google.connector('google_search'),
}

listen((event) => {
  if (event.target?.type !== 'connection') return
  toolCache.delete(event.target.id)
  actionCache.delete(event.target.id)
})

export const connectionService = {
  redirectUrl,

  async reachable({ agent }: { agent: { id: string; owner_id: string } }): Promise<ReachableConnection[]> {
    return db.selectFrom('connection as c').innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.kind', 'c.name'])
      .where('g.agent_id', '=', agent.id).orderBy('c.created_at').execute()
  },

  async list({ actor }: { actor: Caller }): Promise<Connection[]> {
    const rows = await db.selectFrom('connection').select(COLUMNS).orderBy(sql`lower(name)`).orderBy('created_at').execute()
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

  async reconnect({ actor, id, dsn, deployKey, token }: { actor: Caller; id: string } & ReconnectConnection): Promise<Connection> {
    const row = await connectionService.owned({ id })
    const kind = KEYED_KINDS.find((each) => each === row.kind)
    if (row.sign_in || !kind) throw new HttpError(400, `${row.name} connects by signing in. Sign in again instead.`)
    const before = connectionService.unsealed(row.config)
    const url = typeof before.url === 'string' ? before.url : undefined
    const clean = token?.trim()
    if (clean !== undefined && /\s/.test(clean)) throw new HttpError(400, 'Paste the token as it is, with no spaces.', { param: 'token' })
    const { config, account } = await keyedConfig({ kind, dsn, deployKey, url, header: clean ? `Authorization: Bearer ${clean}` : undefined })
    return connectionService.save({ actor, kind, name: row.name, config, account, signIn: false, id })
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
    actionCache.clear()
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
    return toolsShown({ connection, tools, discovered: [...actionCache.get(connection.id)?.values() ?? []] })
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

  async specs({ actor, connectionId }: { actor: Caller; connectionId: string }): Promise<ToolSpec[]> {
    const connection = await connectionService.get({ actor, id: connectionId })
    const specs = await toolsOf({ id: connection.id, kind: connection.kind }).catch((err: unknown) => {
      throw new HttpError(502, `${connection.name} didn't list its tools: ${messageOf(err)}`)
    })
    return permissions.actions({ specs, discovered: [...actionCache.get(connection.id)?.values() ?? []] })
  },

  async call({ agent, name, args, connectionId, reason, origin }: { agent: { id: string; owner_id: string }; name: string; args: Record<string, unknown>; connectionId?: string; reason: string; origin?: unknown }): Promise<{ text: string; isError: boolean }> {
    const matches = (await connectionService.tools({ agent })).filter((tool) => tool.name === name && (!connectionId || tool.connection.id === connectionId))
    if (!matches.length) {
      await record({ agentId: agent.id, connectionId: connectionId ?? null, tool: name, reason, outcome: 'denied', args, error: `This agent has no app with ${name}.` })
      return { text: `Denied: no connection grants ${name} to this agent.`, isError: true }
    }
    if (matches.length > 1) {
      await record({ agentId: agent.id, connectionId: null, tool: name, reason, outcome: 'failed', args, error: `More than one app has ${name}.` })
      return { text: `More than one connection has ${name}; pass connectionId (${matches.map((m) => m.connection.id).join(', ')}).`, isError: true }
    }
    const [{ connection, spec }] = matches
    const action = await actionOf({ connection, spec, args })
    const state = await permissions.decide({ agentId: agent.id, connectionId: connection.id, spec: action?.spec ?? spec })
    if (state === 'deny') {
      await record({ agentId: agent.id, connectionId: connection.id, tool: name, reason, outcome: 'denied', app: connection.name, spec, action, args, error: `Set to Never in ${connection.name}.` })
      return { text: `Not allowed: your owner set ${action?.label ?? name} on ${connection.name} to Never. Don't try it again; tell the person if it matters.`, isError: true }
    }
    if (state === 'ask') {
      const inner = action && { name: action.spec.name, label: action.label }
      const expires = await routineService.inRun(agent.id) ? new Date(Date.now() + ASK_EXPIRES_MS) : undefined
      const asked = await asks.create({ agentId: agent.id, kind: 'call_tool', input: { connectionId: connection.id, tool: spec.name, name, arguments: args, action: inner }, why: reason, origin, expires })
      await record({ agentId: agent.id, connectionId: connection.id, tool: name, reason, outcome: 'asked', app: connection.name, spec, action, args })
      return { text: asked, isError: false }
    }
    return run({ agentId: agent.id, tool: { name, connection, spec }, action, args, reason, approvedBy: null })
  },

  async callApproved({ actor, agentId, connectionId, tool, args, reason }: { actor: Caller; agentId: string; connectionId: string; tool: string; args: Record<string, unknown>; reason: string }): Promise<{ text: string; isError: boolean }> {
    const granted = (await connectionService.tools({ agent: { id: agentId, owner_id: '' } })).find((each) => each.connection.id === connectionId && each.spec.name === tool)
    if (!granted) return { text: `Not run: ${tool} isn't on a connection this agent can use any more.`, isError: true }
    const action = await actionOf({ connection: granted.connection, spec: granted.spec, args })
    if (await permissions.decide({ agentId, connectionId, spec: action?.spec ?? granted.spec }) === 'deny') return { text: `Not run: ${granted.name} was set to Never before it was approved.`, isError: true }
    return run({ agentId, tool: granted, action, args, reason, approvedBy: actor.id })
  },

  callsSince({ agentId, since }: { agentId: string; since: number }): AppCall[] {
    return (journal.get(agentId) ?? []).filter((call) => call.at >= since)
  },

  toolsOf: (connection: { id: string; kind: ConnectionKind }): Promise<ToolSpec[]> => toolsOf(connection),

  execute({ connection, tool, args }: { connection: ReachableConnection; tool: string; args: Record<string, unknown> }): Promise<{ text: string; isError: boolean }> {
    return withConnector(connection, (ctx) => CONNECTORS[connection.kind].call({ ...ctx, tool, args }))
  },
}

async function actionOf({ connection, spec, args }: { connection: ReachableConnection; spec: ToolSpec; args: Record<string, unknown> }): Promise<{ spec: ToolSpec; label: string } | undefined> {
  if (!permissions.isCatchAll(spec)) return undefined
  const declared = Object.keys(spec.schema.properties ?? {})
  const keys = (declared.length ? declared : Object.keys(args)).filter((each) => /name|tool/i.test(each) && typeof args[each] === 'string')
  const name = keys.length === 1 ? String(args[keys[0]]) : ''
  if (!name || name.startsWith('*')) return { spec: { name: '*other', description: humanized(spec.name), schema: {} }, label: humanized(spec.name) }
  const known = actionCache.get(connection.id) ?? new Map<string, ToolSpec>()
  actionCache.set(connection.id, known)
  const found = known.get(name) ?? await lookUp({ connection, name }).catch((err: unknown) => {
    log.warn({ event: 'connection.action_lookup_failed', connection: connection.id, error: messageOf(err) })
    return undefined
  })
  if (found) known.set(name, found)
  const action = found ?? { name, description: humanized(name), schema: {} }
  return { spec: action, label: actionLabel(action) }
}

export function toolsShown({ connection, tools, discovered }: { connection: { kind: string; name: string }; tools: ToolSpec[]; discovered: ToolSpec[] }): ConnectionTool[] {
  const catchAll = tools.find(permissions.isCatchAll)
  const shown = ({ tool, kind, label }: { tool: ToolSpec; kind: ConnectionTool['kind']; label: string }): ConnectionTool => ({ object: 'connection_tool', name: `${connection.kind}_${tool.name}`, label, description: tool.description, group: permissions.groupOf(tool), kind })
  const plain = tools.filter((tool) => !permissions.isCatchAll(tool) && !(catchAll && DISCOVERY.test(tool.name))).map((tool) => shown({ tool, kind: 'tool', label: labelOf({ name: tool.name, title: tool.annotations?.title }).label }))
  if (!catchAll) return plain
  return [...plain, shown({ tool: catchAll, kind: 'catch_all', label: `Any ${connection.name} action` }), ...discovered.map((tool) => shown({ tool, kind: 'action', label: actionLabel(tool) }))]
}

function actionLabel(action: ToolSpec): string {
  return action.annotations?.title || (action.description.length <= 60 ? action.description : humanized(action.name))
}

// ponytail: the action list lives in memory, so a restart forgets which inner actions were seen (their saved settings stay).
async function lookUp({ connection, name }: { connection: ReachableConnection; name: string }): Promise<ToolSpec> {
  const lookups = (await toolsOf(connection)).filter((tool) => !permissions.isCatchAll(tool) && DISCOVERY.test(tool.name))
    .sort((a, b) => Number(/schema|describe/i.test(b.name)) - Number(/schema|describe/i.test(a.name)))
  for (const tool of lookups) {
    const arg = firstStringArg(tool.schema) ?? 'name'
    const result = await connectionService.execute({ connection, tool: tool.name, args: { [arg]: name } })
    const found = result.isError ? undefined : labeled({ value: parsed(result.text), name })
    if (found) return found
  }
  return { name, description: humanized(name), schema: {} }
}

function labeled({ value, name }: { value: unknown; name: string }): ToolSpec | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const each = value as Record<string, unknown>
  const named = typeof each.name !== 'string' || each.name === name || name.endsWith(`/${each.name}`)
  const annotations = each.annotations
  if (named && typeof annotations === 'object' && annotations !== null) {
    const description = typeof each.description === 'string' ? each.description : humanized(name)
    const meta = typeof each._meta === 'object' && each._meta !== null ? each._meta as Record<string, unknown> : undefined
    return { name, description, schema: {}, annotations: annotations as ToolSpec['annotations'], meta }
  }
  for (const child of Object.values(each)) {
    const found = labeled({ value: child, name })
    if (found) return found
  }
  return undefined
}

function firstStringArg(schema: Record<string, unknown>): string | undefined {
  const properties = (schema.properties ?? {}) as Record<string, { type?: unknown }>
  const required = Array.isArray(schema.required) ? schema.required.map(String) : []
  return [...required, ...Object.keys(properties)].find((key) => properties[key]?.type === 'string')
}

function parsed(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function humanized(name: string): string {
  const words = (name.split('/').pop() ?? name).replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

async function run({ agentId, tool: { name, connection, spec }, action, args, reason, approvedBy }: { agentId: string; tool: AgentTool; action?: Action; args: Record<string, unknown>; reason: string; approvedBy: string | null }): Promise<{ text: string; isError: boolean }> {
  const started = Date.now()
  const done = (outcome: 'allowed' | 'failed', output: string) => record({ agentId, connectionId: connection.id, tool: name, reason, outcome, ms: Date.now() - started, approvedBy, app: connection.name, spec, action, args, ...outcome === 'failed' ? { error: output } : { output } })
  const key = `${agentId}:${connection.id}`
  const inFlight = running.get(key) ?? 0
  if (inFlight >= PER_AGENT_CONNECTION) {
    await done('failed', 'Too many calls to this app at once.')
    return { text: `Busy: ${inFlight} calls to this connection are already running for this agent. Wait for them to finish.`, isError: true }
  }
  running.set(key, inFlight + 1)
  try {
    const sent = await signedArgs({ agentId, kind: connection.kind, tool: spec.name, args })
    const result = await connectionService.execute({ connection, tool: spec.name, args: sent })
    if (result.text.length > MAX_REPLY) throw new Error(`Result too large for the agent (${Math.round(result.text.length / 1024)} KB, the limit is 64 KB). Ask for less.`)
    await done(result.isError ? 'failed' : 'allowed', redact(result.text))
    return { text: redact(result.text), isError: result.isError }
  } catch (err) {
    await done('failed', redact(messageOf(err)))
    return { text: redact(`Failed: ${messageOf(err)}`).slice(0, 2000), isError: true }
  } finally {
    running.set(key, (running.get(key) ?? 1) - 1)
  }
}

async function signedArgs({ agentId, kind, tool, args }: { agentId: string; kind: ConnectionKind; tool: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  let sent = args
  for (const plugin of plugins()) if (plugin.connectorCall) sent = await plugin.connectorCall({ agentId, kind, tool, args: sent })
  return sent
}

async function record({ agentId, connectionId, tool, reason, outcome, ms = 0, approvedBy = null, app, spec, action, args, output, error }: { agentId: string; connectionId: string | null; tool: string; reason: string; outcome: Outcome; ms?: number; approvedBy?: string | null; app?: string; spec?: ToolSpec; action?: Action; args: Record<string, unknown>; output?: string; error?: string }): Promise<void> {
  const calls = journal.get(agentId) ?? []
  calls.push({ at: Date.now(), name: tool, connectionId, app: app ?? null, spec, action, args, outcome, ms, output: output?.slice(0, JOURNAL_TEXT), error: error?.slice(0, JOURNAL_TEXT) })
  journal.set(agentId, calls.slice(-JOURNAL))
  await db.insertInto('connection_event').values({ agent_id: agentId, connection_id: connectionId, tool, reason: reason.slice(0, 500), outcome, ms, approved_by: approvedBy }).execute()
}

async function keyedConfig({ kind, dsn, deployKey, url, header }: Omit<CreateConnection, 'name'>): Promise<{ config: Secret; account: string }> {
  if (kind === 'convex') {
    if (!deployKey) throw new HttpError(400, 'Paste the deploy key.', { param: 'deployKey' })
    return { config: { deployKey: deployKey.trim() }, account: await convex.probe(deployKey.trim()) }
  }
  if (kind === 'excalidraw') return { config: {}, account: new URL(MCP_SERVERS.excalidraw).host }
  if (kind === 'mcp') {
    if (!url) throw new HttpError(400, 'Paste the MCP server URL.', { param: 'url' })
    const headers = mcp.parseHeader(header)
    const tools = await mcp.probe({ url, headers }).catch((err: unknown) => {
      throw new HttpError(400, `${new URL(url).host} didn't answer as an MCP server: ${messageOf(err)}. If it needs a sign-in, choose Sign in instead.`, { param: 'url' })
    })
    return { config: { url, headers }, account: `${new URL(url).host} · ${tools} tools` }
  }
  if (!dsn) throw new HttpError(400, 'Paste a postgres:// connection string.', { param: 'dsn' })
  return { config: { dsn }, account: await postgres.probe(dsn) }
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
    db.selectFrom('connection_event').select((eb) => ['connection_id', eb.fn.max('at').as('at')]).where('connection_id', 'in', ids).where('outcome', '=', 'failed').groupBy('connection_id').execute(),
  ])
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.email]))
  const agents = new Map(counts.map((count) => [count.connection_id, Number(count.n)]))
  const lastSuccess = new Map(successes.map((success) => [success.connection_id, success.at]))
  const lastFailure = new Map(failures.map((failure) => [failure.connection_id, failure.at]))
  return rows.map((row) => {
    const success = lastSuccess.get(row.id)
    return {
      id: row.id, object: 'connection', kind: row.kind, name: row.name, account: row.account, signIn: row.sign_in,
      ownerId: row.owner_id, ownerName: ownerName.get(row.owner_id) ?? 'someone',
      canDelete: true, agents: agents.get(row.id) ?? 0,
      status: statusOf({ success, failure: lastFailure.get(row.id) }), lastSuccessAt: success ? new Date(success).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
    }
  })
}

function statusOf({ success, failure }: { success?: Date | string | null; failure?: Date | string | null }): ConnectionStatus {
  if (failure && (!success || new Date(failure) > new Date(success))) return 'failing'
  if (success) return 'connected'
  return 'no_calls'
}

const isSignIn = (kind: ConnectionKind): boolean => (SIGN_IN_KINDS as readonly string[]).includes(kind)

export type ReachableConnection = { id: string; kind: ConnectionKind; name: string }
export type AppCall = { at: number; name: string; connectionId: string | null; app: string | null; spec?: ToolSpec; action?: Action; args: Record<string, unknown>; outcome: Outcome; ms: number; output?: string; error?: string }
type Outcome = 'allowed' | 'asked' | 'denied' | 'failed'
type Action = { spec: ToolSpec; label: string }
export type AgentTool = { name: string; connection: ReachableConnection; spec: ToolSpec }

type Row = Pick<Selectable<Database['connection']>, (typeof COLUMNS)[number]>
