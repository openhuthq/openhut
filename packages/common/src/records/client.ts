import * as z from 'zod/mini'
import { ApiError, List } from '../api.ts'
import { agentFacts, allowed, runsOnAllowed, type AgentFacts, type Roster } from './allowed.ts'
import { open, seal, verify, type Keys, type Opened, type Signer, type Value, type Where } from './seal.ts'
import { PER_AGENT, SealedConflict, SealedRow, type Collection } from './wire.ts'

export type Seen = { ver: number; parent: string | null }
export type RecordsClient = ReturnType<typeof recordsClient>
type Expect = { collection: Collection; workspace: string; parent?: string | null; ids?: string[] }
type Agents = Map<string, Promise<AgentFacts | null>>
type Reply = { status: number; json: unknown }
type Checked = { row: SealedRow; roster: Roster; agent: AgentFacts | null }

const Page = List(z.unknown())

export class RecordsError extends Error {
  readonly status: number
  readonly type: string
  readonly current: Opened | null

  constructor({ status, type = 'api_error', message, current = null }: { status: number; type?: string; message: string; current?: Opened | null }) {
    super(message)
    this.status = status
    this.type = type
    this.current = current
  }
}

export function recordsClient({ baseUrl, token, device, keys, roster, seen = () => undefined, fetch: send = globalThis.fetch }: {
  baseUrl: string
  token: () => string | Promise<string>
  device: Signer
  keys: Keys
  roster: (workspace: string) => Roster | null | undefined
  seen?: (id: string) => Seen | undefined
  fetch?: typeof globalThis.fetch
}) {
  async function call({ method, path, body }: { method: 'GET' | 'PUT' | 'POST'; path: string; body?: unknown }): Promise<Reply> {
    const headers = { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
    const response = await send(`${baseUrl}/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json().catch(() => null) }
  }

  async function checked({ json, expect, agents }: { json: unknown; expect: Expect; agents: Agents }): Promise<Checked | null> {
    const row = SealedRow.safeParse(json).data
    const list = row && roster(row.workspace)
    const held = row && seen(row.id)
    if (!row || !list || row.object !== expect.collection || row.workspace !== expect.workspace) return null
    if ((expect.parent !== undefined && row.parent !== expect.parent) || (expect.ids && !expect.ids.includes(row.id))) return null
    if (held && (row.ver < held.ver || row.parent !== held.parent)) return null
    const agent = PER_AGENT.includes(row.object) && row.parent ? await agentOf({ workspace: row.workspace, id: row.parent, agents }) : null
    return allowed({ row, roster: list, agent }) ? { row, roster: list, agent } : null
  }

  function agentOf({ workspace, id, agents }: { workspace: string; id: string; agents: Agents }): Promise<AgentFacts | null> {
    const found = agents.get(id) ?? fetchAgent({ workspace, id, agents })
    agents.set(id, found)
    return found
  }

  async function fetchAgent({ workspace, id, agents }: { workspace: string; id: string; agents: Agents }): Promise<AgentFacts | null> {
    const reply = await call({ method: 'GET', path: `agent/${encodeURIComponent(id)}` })
    const ok = reply.status === 200 ? await checked({ json: reply.json, expect: { collection: 'agent', workspace, ids: [id] }, agents }) : null
    return ok && await verify(ok.row) ? agentFacts({ ...ok.row, id }) : null
  }

  async function accept({ json, expect, agents = new Map() }: { json: unknown; expect: Expect; agents?: Agents }): Promise<Opened | null> {
    const ok = await checked({ json, expect, agents })
    const opened = ok && await open({ row: ok.row, keys })
    if (!ok || !opened) return null
    const runsOn = ok.row.object === 'control' ? placedOn(opened.value) : null
    if (runsOn === null || runsOn === undefined) return opened
    return typeof runsOn === 'string' && ok.agent && runsOnAllowed({ roster: ok.roster, agent: ok.agent, runsOn }) ? opened : null
  }

  async function many({ reply, expect }: { reply: Reply; expect: Expect }): Promise<{ data: Opened[]; next: string | null }> {
    const page = Page.safeParse(reply.json).data
    if (reply.status !== 200 || !page) throw failure(reply)
    const agents: Agents = new Map()
    const data = await Promise.all(page.data.map((json) => accept({ json, expect, agents })))
    const last = SealedRow.safeParse(page.data.at(-1)).data?.id ?? null
    return { data: data.filter((row) => row !== null), next: page.hasMore ? last : null }
  }

  async function get({ collection, workspace, id }: { collection: Collection; workspace: string; id: string }): Promise<Opened | null> {
    const reply = await call({ method: 'GET', path: `${collection}/${encodeURIComponent(id)}` })
    if (reply.status === 404) return null
    if (reply.status !== 200) throw failure(reply)
    return accept({ json: reply.json, expect: { collection, workspace, ids: [id] } })
  }

  async function write({ where, ver, value }: { where: Where; ver: number; value: Value | null }): Promise<{ saved: Opened } | { latest: Opened | null }> {
    const sealed = await seal({ where, ver, value, keys, signer: device })
    if (!sealed) throw new RecordsError({ status: 400, type: 'invalid_request_error', message: 'This device doesn’t hold the key to seal that record.' })
    const reply = await call({ method: 'PUT', path: `${where.collection}/${encodeURIComponent(where.id)}`, body: sealed })
    if (reply.status === 409) {
      const current = SealedConflict.safeParse(reply.json).data?.current
      const expect = { collection: where.collection, workspace: where.workspace, parent: where.parent, ids: [where.id] }
      return { latest: current ? await accept({ json: current, expect }) : await get(where) }
    }
    if (reply.status !== 200) throw failure(reply)
    const saved = await open({ row: { id: where.id, object: where.collection, ...sealed }, keys })
    if (!saved) throw new RecordsError({ status: 500, message: 'This record didn’t open after sealing it.' })
    return { saved }
  }

  async function save({ where, current, value, again }: { where: Where; current: number; value: Value | null; again?: (latest: Opened) => Promise<Value | null | undefined> }): Promise<Opened> {
    const first = await write({ where, ver: current + 1, value })
    if ('saved' in first) return first.saved
    const next = first.latest && again ? await again(first.latest) : undefined
    const second = first.latest && next !== undefined ? await write({ where, ver: first.latest.ver + 1, value: next }) : first
    if ('saved' in second) return second.saved
    throw new RecordsError({ status: 409, type: 'invalid_request_error', message: 'Someone else changed this record first. Load it again and retry.', current: second.latest })
  }

  return {
    by: device.key,

    get,

    async list({ collection, workspace, parent, startingAfter, limit }: { collection: Collection; workspace: string; parent?: string; startingAfter?: string; limit?: number }): Promise<{ data: Opened[]; next: string | null }> {
      const query = new URLSearchParams({ workspace, ...(parent ? { parent } : {}), ...(startingAfter ? { starting_after: startingAfter } : {}), ...(limit ? { limit: String(limit) } : {}) })
      return many({ reply: await call({ method: 'GET', path: `${collection}?${query}` }), expect: { collection, workspace, parent } })
    },

    async batchGet({ collection, workspace, ids }: { collection: Collection; workspace: string; ids: string[] }): Promise<Opened[]> {
      const reply = await call({ method: 'POST', path: `${collection}/batch-get`, body: { ids } })
      return (await many({ reply, expect: { collection, workspace, ids } })).data
    },

    put({ collection, workspace, parent = null, id, current = 0, value, reapply }: Omit<Where, 'parent'> & { parent?: string | null; current?: number; value: Value; reapply?: (latest: Opened) => Value | null | Promise<Value | null> }): Promise<Opened> {
      const again = reapply && (async (latest: Opened) => (await reapply(latest)) ?? undefined)
      return save({ where: { collection, workspace, parent, id }, current, value, again })
    },

    remove({ collection, workspace, parent = null, id, current }: Omit<Where, 'parent'> & { parent?: string | null; current: number }): Promise<Opened> {
      return save({ where: { collection, workspace, parent, id }, current, value: null, again: async () => null })
    },
  }
}

function placedOn(value: Value): unknown {
  const control = value.workspace ?? value.own
  return typeof control === 'object' && control !== null && 'runsOn' in control ? control.runsOn : null
}

function failure(reply: Reply): RecordsError {
  const error = ApiError.safeParse(reply.json).data?.error
  return new RecordsError({ status: reply.status, type: error?.type, message: error?.message ?? `The cloud answered with status ${reply.status}.` })
}
