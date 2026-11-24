import * as z from 'zod/mini'
import { ApiError, List } from '../api.ts'
import { agentFacts, allowed, runsOnAllowed, type AgentFacts, type Roster } from '../records/allowed.ts'
import { open, seal, verify, type Keys, type Opened, type Signer, type Value, type Where } from '../records/seal.ts'
import { PER_AGENT, SealedConflict, SealedRow, type Collection } from '../records/wire.ts'

export type Seen = { ver: number; parent: string | null }
export type RecordsClient = ReturnType<typeof recordsClient>
type Expect = { collection: Collection; workspace: string; parent?: string | null; id?: string }
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

export type Send = (input: { method: 'GET' | 'PUT'; workspace: string; kind: Collection; id?: string; query?: Record<string, string | number | undefined>; body?: unknown }) => Promise<Reply>
export type RecordsOptions = {
  device: Signer
  keys: Keys
  roster: (workspace: string) => Roster | null | undefined
  seen?: (id: string, collection: Collection) => Seen | undefined
}

export function recordsClient({ send: call, device, keys, roster, seen = () => undefined }: RecordsOptions & { send: Send }) {

  async function checked({ json, expect, agents }: { json: unknown; expect: Expect; agents: Agents }): Promise<Checked | null> {
    const row = SealedRow.safeParse(json).data
    const list = row && roster(row.workspace)
    const held = row && seen(row.id, row.object)
    if (!row || !list || row.object !== expect.collection || row.workspace !== expect.workspace) return null
    if ((expect.parent !== undefined && row.parent !== expect.parent) || (expect.id !== undefined && row.id !== expect.id)) return null
    if (held && (row.ver < held.ver || row.parent !== held.parent)) return null
    const agent = PER_AGENT.includes(row.object) && row.parent ? await agentOf({ workspace: row.workspace, id: row.parent, agents }) : null
    return allowed({ row, roster: list, mode: 'read', agent }) ? { row, roster: list, agent } : null
  }

  function agentOf({ workspace, id, agents }: { workspace: string; id: string; agents: Agents }): Promise<AgentFacts | null> {
    const found = agents.get(id) ?? fetchAgent({ workspace, id, agents })
    agents.set(id, found)
    return found
  }

  async function fetchAgent({ workspace, id, agents }: { workspace: string; id: string; agents: Agents }): Promise<AgentFacts | null> {
    const reply = await call({ method: 'GET', workspace, kind: 'agent', id })
    if (reply.status === 0) throw failure(reply)
    const ok = reply.status === 200 ? await checked({ json: reply.json, expect: { collection: 'agent', workspace, id }, agents }) : null
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
    const reply = await call({ method: 'GET', workspace, kind: collection, id })
    if (reply.status === 404) return null
    if (reply.status !== 200) throw failure(reply)
    return accept({ json: reply.json, expect: { collection, workspace, id } })
  }

  async function write({ where, ver, value }: { where: Where; ver: number; value: Value | null }): Promise<{ saved: Opened } | { latest: Opened | null }> {
    const sealed = await seal({ where, ver, value, keys, signer: device })
    if (!sealed) throw new RecordsError({ status: 400, type: 'invalid_request_error', message: 'This device doesn’t hold the key to seal that record.' })
    const list = roster(where.workspace)
    const agent = PER_AGENT.includes(where.collection) && where.parent ? await agentOf({ workspace: where.workspace, id: where.parent, agents: new Map() }) : null
    if (!list || !allowed({ row: { id: where.id, object: where.collection, ...sealed }, roster: list, mode: 'write', agent })) {
      throw new RecordsError({ status: 403, type: 'invalid_request_error', message: 'The team’s rules don’t let this device write that record.' })
    }
    const reply = await call({ method: 'PUT', workspace: where.workspace, kind: where.collection, id: where.id, body: sealed })
    if (reply.status === 409) {
      const current = SealedConflict.safeParse(reply.json).data?.current
      const expect = { collection: where.collection, workspace: where.workspace, parent: where.parent, id: where.id }
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
      return many({ reply: await call({ method: 'GET', workspace, kind: collection, query: { parent, after: startingAfter, limit } }), expect: { collection, workspace, parent } })
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
  return new RecordsError({ status: reply.status, type: error?.type, message: error?.message ?? (reply.status ? `The cloud answered with status ${reply.status}.` : 'OpenHut Cloud didn’t answer. Check this computer’s internet connection.') })
}
