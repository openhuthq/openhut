import { Access, canonical, computerId, hexOf, verify, type AccessComputer, type Client, type Unsigned } from '@openhut/common/access/access.ts'
import { ApiError, Deleted, List } from '@openhut/common/api.ts'
import { Admin, Export, MIN_RUNTIME_VERSION, type Subscription } from '@openhut/common/admin/admin.ts'
import { Agent, AgentImport, Grant, type CreateAgent, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import { Connection, ConnectionAuthorization, SIGN_IN_KINDS, type CreateConnection, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import { Me } from '@openhut/common/team/team.ts'
import { PROVIDERS, Provider, type ProviderId } from '@openhut/common/models/provider.ts'

export type StoredComputer = { id: string; name: string; url: string }
export type Features = { whatsapp: boolean; browser: boolean }
export type Computer = StoredComputer & { online: boolean; features: Features; appTooOld: boolean; runtimeTooOld: boolean }
export type TailnetPeer = { name: string; dns: string }
export type Transport = (path: string, init?: RequestInit) => Promise<Response>
export type Where = { computer: string } | { of: string }
export type Platform = {
  transport: (computer: StoredComputer) => Transport
  store: {
    computers: () => Promise<StoredComputer[]>
    add: (peer: TailnetPeer) => Promise<StoredComputer>
    remove: (id: string) => Promise<void>
  }
  openUrl: (url: string) => void
  appVersion?: string
  owner?: () => Promise<Owner>
  signed?: { read: () => Promise<Access | undefined>; save: (list: Access) => Promise<void> }
}
export type Owner = { key: string; sign: (text: string) => Promise<string>; self: { key: string; name: string } }
export type Device = Client & { self: boolean }
export type Joined = { name: string; kind: 'client' | 'computer'; key: string }
export type OpenHutAgent = Agent & { computer: string; online: boolean }
export type Copy = { computer: string; id: string; online: boolean }
export type OpenHutConnection = Connection & { computers: Copy[] }
export type Behind = Record<Subscription, string[]>
export type ProviderRow = { computer: string; online: boolean; providers: Provider[] }
export type MergedProvider = Provider & { computers: string[] }
export type Moved = { agent: OpenHutAgent; ungranted: string[] }
export type OpenHut = ReturnType<typeof createOpenHut>

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }
type Call<T> = { computer: StoredComputer; path: string; schema: Schema<T>; method?: string; body?: unknown }
type Held = { access: Access | null; key: string }

const AGENT_LIST = List(Agent)
const CONNECTION_LIST = List(Connection)
const AGENT_DELETED = Deleted('agent')
const PROVIDER_LIST = List(Provider)
const SUBSCRIPTIONS = ['claude'] as const satisfies Subscription[]
const POLL_MS = 60_000

export class RequestError extends Error {
  readonly status: number
  readonly param: string | undefined

  constructor({ message, status, param }: { message: string; status: number; param?: string }) {
    super(message)
    this.status = status
    this.param = param
  }
}

export function createOpenHut(platform: Platform) {
  const online = new Map<string, boolean>()
  const agentsSeen = new Map<string, Agent[]>()
  const connectionsSeen = new Map<string, Connection[]>()
  const adminsSeen = new Map<string, Admin>()
  const providersSeen = new Map<string, Provider[]>()
  const homes = new Map<string, string>()
  const accessSeen = new Map<string, Held>()
  let signedLast: Access | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let syncing: Promise<Access | undefined> | undefined
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  let last = ''

  async function call<T>({ computer, path, schema, method = 'GET', body }: Call<T>): Promise<T> {
    const json = body === undefined ? undefined : JSON.stringify(body)
    const response = await platform.transport(computer)(path, { method, body: json, headers: json ? { 'content-type': 'application/json' } : {} })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw failure({ computer, status: response.status, payload })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new RequestError({ message: `${computer.name} sent an answer this app doesn't understand. Update OpenHut on it and try again.`, status: response.status })
    return parsed.data
  }

  async function computer(id: string): Promise<StoredComputer> {
    const found = (await platform.store.computers()).find((each) => each.id === id)
    if (!found) throw new RequestError({ message: 'That computer isn\'t in your list anymore. Refresh and try again.', status: 404 })
    return found
  }

  async function across<T>({ seen, read }: { seen: Map<string, T>; read: (computer: StoredComputer) => Promise<T> }) {
    return Promise.all((await platform.store.computers()).map(async (each) => {
      const fresh = await read(each).then((value) => ({ value }), () => undefined)
      online.set(each.id, !!fresh)
      if (fresh) seen.set(each.id, fresh.value)
      return { computer: each, online: !!fresh, value: seen.get(each.id) }
    }))
  }

  async function homeOf(id: string): Promise<StoredComputer> {
    if (!homes.has(id)) await Promise.all([agents.list(), connections.list()])
    return computer(homes.get(id) ?? '')
  }

  async function copy<T>({ from, to, what, schema }: { from: StoredComputer; to: StoredComputer; what: { connectionId: string } | { subscription: Subscription }; schema: Schema<T> }): Promise<T> {
    const { publicKey } = await call({ computer: to, path: '/api/admin', schema: Admin })
    const { sealed } = await call({ computer: from, path: '/api/admin/exports', method: 'POST', body: { publicKey, ...what }, schema: Export })
    return call({ computer: to, path: '/api/admin/imports', method: 'POST', body: { sealed }, schema })
  }

  const computers = {
    async list(): Promise<Computer[]> {
      const rows = await across({ seen: adminsSeen, read: (each) => call({ computer: each, path: '/api/admin', schema: Admin }) })
      return rows.map((row) => ({
        ...row.computer, online: row.online, features: row.value?.features ?? { whatsapp: !!row.computer.url, browser: !!row.computer.url },
        appTooOld: !!platform.appVersion && !!row.value?.minAppVersion && older({ version: platform.appVersion, than: row.value.minAppVersion }),
        runtimeTooOld: !!row.computer.url && !!row.value && older({ version: row.value.server.build, than: MIN_RUNTIME_VERSION }),
      }))
    },
    async add(peer: TailnetPeer): Promise<Computer> {
      const added = await platform.store.add(peer)
      await account.sync().catch(() => undefined)
      return { ...added, online: true, features: { whatsapp: true, browser: true }, appTooOld: false, runtimeTooOld: false }
    },
    remove: (id: string): Promise<void> => platform.store.remove(id),
  }

  const agents = {
    async list(): Promise<OpenHutAgent[]> {
      const rows = await across({ seen: agentsSeen, read: (each) => call({ computer: each, path: '/api/agents', schema: AGENT_LIST }).then((page) => page.data) })
      const copies = rows.flatMap((row) => (row.value ?? []).map((agent) => ({ ...agent, computer: row.computer.id, online: row.online })))
      const picked = new Map<string, OpenHutAgent>()
      for (const agent of copies) {
        const found = picked.get(agent.id)
        if (!found || (agent.runsHere && agent.online && !(found.runsHere && found.online))) picked.set(agent.id, agent)
      }
      for (const agent of picked.values()) homes.set(agent.id, agent.computer)
      return [...picked.values()]
    },
    async create({ computer: id, ...body }: CreateAgent & { computer: string }): Promise<OpenHutAgent> {
      const agent = await call({ computer: await computer(id), path: '/api/agents', method: 'POST', body, schema: Agent })
      homes.set(agent.id, id)
      return { ...agent, computer: id, online: true }
    },
    async update({ id, change }: { id: string; change: UpdateAgent }): Promise<OpenHutAgent> {
      const home = await homeOf(id)
      const agent = await call({ computer: home, path: `/api/agents/${encodeURIComponent(id)}`, method: 'PATCH', body: change, schema: Agent })
      return { ...agent, computer: home.id, online: true }
    },
    async move({ id, to }: { id: string; to: string }): Promise<Moved> {
      const [from, target] = [await homeOf(id), await computer(to)]
      if (from.id === target.id) throw new RequestError({ message: `It's already on ${target.name}.`, status: 409, param: 'to' })
      const path = `/api/agents/${encodeURIComponent(id)}`
      const { wanted } = await call({ computer: from, path, schema: Agent })
      const restart = async (where: StoredComputer) => { if (wanted === 'running') await call({ computer: where, path, method: 'PATCH', body: { wanted }, schema: Agent }) }
      await call({ computer: from, path, method: 'PATCH', body: { wanted: 'stopped' }, schema: Agent })
      let moved: AgentImport | undefined
      let imported: 'no' | 'maybe' | 'yes' = 'no'
      try {
        const { publicKey } = await call({ computer: target, path: '/api/admin', schema: Admin })
        const { sealed } = await call({ computer: from, path: `${path}/export`, method: 'POST', body: { publicKey }, schema: Export })
        imported = 'maybe'
        moved = await call({ computer: target, path: '/api/agents/imports', method: 'POST', body: { sealed }, schema: AgentImport }).catch((err: unknown) => {
          if (err instanceof RequestError && err.status < 500) imported = 'no'
          throw err
        })
        imported = 'yes'
        await restart(target)
      } catch (err) {
        const gone = imported === 'no' || await call({ computer: target, path, method: 'DELETE', schema: AGENT_DELETED }).then(() => true, (missing: unknown) => missing instanceof RequestError && missing.status === 404)
        if (!gone) throw new RequestError({ message: `The move stopped (${messageOf(err)}), and ${target.name} may still have a copy, so ${from.name} keeps it stopped to never run it twice. Delete it on ${target.name}, then start it on ${from.name}.`, status: 502 })
        await restart(from).catch(() => undefined)
        throw err
      }
      homes.set(id, target.id)
      await call({ computer: from, path, method: 'DELETE', schema: AGENT_DELETED }).catch((err: unknown) => {
        throw new RequestError({ message: `${moved?.agent.name ?? 'The agent'} is on ${target.name} now, but ${from.name} couldn't delete its old copy (${messageOf(err)}). Delete it there.`, status: 502 })
      })
      return { agent: { ...moved.agent, wanted, computer: target.id, online: true }, ungranted: moved.ungranted }
    },
    home: (id: string): string | undefined => homes.get(id),
  }

  const connections = {
    async list(): Promise<OpenHutConnection[]> {
      const rows = await across({ seen: connectionsSeen, read: (each) => call({ computer: each, path: '/api/connections', schema: CONNECTION_LIST }).then((page) => page.data) })
      const merged = new Map<string, OpenHutConnection>()
      for (const row of rows) {
        for (const connection of row.value ?? []) {
          homes.set(connection.id, row.computer.id)
          const where = { computer: row.computer.id, id: connection.id, online: row.online }
          const key = `${connection.kind}\n${connection.name}`
          const found = merged.get(key)
          if (found) found.computers.push(where)
          else merged.set(key, { ...connection, computers: [where] })
        }
      }
      return [...merged.values()]
    },
    async connect({ computer: id, ...body }: CreateConnection & { computer: string }): Promise<Connection> {
      return call({ computer: await computer(id), path: '/api/connections', method: 'POST', body, schema: Connection })
    },
    async signIn({ computer: id, ...body }: CreateConnectionAuthorization & { computer: string }): Promise<ConnectionAuthorization> {
      const authorization = await call({ computer: await computer(id), path: '/api/connection-authorizations', method: 'POST', body, schema: ConnectionAuthorization })
      if (!authorization.manifest) platform.openUrl(authorization.authorizationUrl)
      return authorization
    },
    async addTo({ id, computer: to }: { id: string; computer: string }): Promise<Connection | ConnectionAuthorization> {
      const found = (await connections.list()).find((each) => each.computers.some((where) => where.id === id))
      if (!found) throw new RequestError({ message: 'That connection isn\'t on any of your computers anymore. Refresh and try again.', status: 404 })
      const there = found.computers.find((where) => where.computer === to)
      if (there) return { ...found, id: there.id }
      if (found.signIn) return connections.signIn({ computer: to, kind: signInKind(found.kind), name: found.name })
      const from = found.computers.find((where) => where.online)
      if (!from) throw new RequestError({ message: `Every computer with ${found.name} is offline. Try again when one is back.`, status: 409 })
      return copy({ from: await computer(from.computer), to: await computer(to), what: { connectionId: from.id }, schema: Connection })
    },
    async grant({ connection, agent }: { connection: string; agent: string }): Promise<Grant> {
      const home = await homeOf(agent)
      const found = (await connections.list()).find((each) => each.computers.some((where) => where.id === connection))
      const there = found?.computers.find((where) => where.computer === home.id)
      if (!there) throw new RequestError({ message: `${found?.name ?? 'That connection'} isn't on ${home.name} yet. Add it there first.`, status: 409, param: 'connectionId' })
      return call({ computer: home, path: '/api/grants', method: 'POST', body: { agentId: agent, connectionId: there.id }, schema: Grant })
    },
  }

  const providers = {
    async list(): Promise<ProviderRow[]> {
      const rows = await across({ seen: providersSeen, read: (each) => call({ computer: each, path: '/api/providers', schema: PROVIDER_LIST }).then((page) => page.data) })
      return rows.map((row) => ({ computer: row.computer.id, online: row.online, providers: row.value ?? [] }))
    },
    async connect({ id, apiKey, computers: ids }: { id: ProviderId; apiKey: string; computers: string[] }): Promise<void> {
      if (!ids.length) throw new RequestError({ message: 'Pick at least one computer to put it on.', status: 400, param: 'computers' })
      for (const [index, target] of ids.entries()) {
        const each = await computer(target)
        await call({ computer: each, path: `/api/providers/${id}`, method: 'PATCH', body: { apiKey }, schema: Provider }).catch((err: unknown) => {
          if (!index) throw err
          throw new RequestError({ message: err instanceof RequestError ? `${each.name}: ${err.message}` : `${each.name} didn't answer.`, status: err instanceof RequestError ? err.status : 502 })
        })
      }
    },
    async refresh(id: ProviderId): Promise<void> {
      for (const each of await holders(id)) await call({ computer: each, path: `/api/providers/${id}/refresh`, method: 'POST', schema: Provider })
    },
    async setModels({ id, models }: { id: ProviderId; models: { id: string; on: boolean }[] }): Promise<void> {
      for (const each of await holders(id)) await call({ computer: each, path: `/api/providers/${id}`, method: 'PATCH', body: { models }, schema: Provider })
    },
    async disconnect(id: ProviderId): Promise<void> {
      for (const each of await holders(id)) await call({ computer: each, path: `/api/providers/${id}`, method: 'DELETE', schema: Provider })
    },
  }

  async function holders(id: ProviderId): Promise<StoredComputer[]> {
    const rows = (await providers.list()).filter((row) => row.online && row.providers.some((each) => each.id === id && each.connected))
    return Promise.all(rows.map((row) => computer(row.computer)))
  }

  const account = {
    async me(): Promise<Me> {
      const [first, ...rest] = await platform.store.computers()
      if (!first) throw new RequestError({ message: 'Add a computer first.', status: 404 })
      const ask = (each: StoredComputer) => call({ computer: each, path: '/api/me', schema: Me })
      return rest.reduce((answer, each) => answer.catch(() => ask(each)), ask(first))
    },
    async sync(): Promise<Behind> {
      const rows = await across({ seen: adminsSeen, read: (each) => call({ computer: each, path: '/api/admin', schema: Admin }) })
      const behind: Behind = { claude: [], codex: [] }
      for (const kind of SUBSCRIPTIONS) {
        const rank = (admin: Admin | undefined) => signedIn({ admin, kind })
        const [source] = rows.filter((row) => row.online).sort((a, b) => rank(b.value).localeCompare(rank(a.value)))
        if (!source || !rank(source.value)) continue
        for (const row of rows.filter((each) => rank(each.value) < rank(source.value))) {
          if (!row.online) behind[kind].push(row.computer.id)
          else adminsSeen.set(row.computer.id, await copy({ from: source.computer, to: row.computer, what: { subscription: kind }, schema: Admin }))
        }
      }
      return behind
    },
  }

  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  async function held(each: StoredComputer): Promise<Held> {
    const { publicKey, relay } = await call({ computer: each, path: '/api/admin', schema: Admin })
    const access = await call({ computer: each, path: '/api/access', schema: Access }).catch((err: unknown) => {
      if (err instanceof RequestError && err.status === 404) return null
      throw err
    })
    return { access, key: relay?.key ?? hexOf(Uint8Array.from(atob(publicKey), (char) => char.charCodeAt(0)).subarray(-32)) }
  }

  async function newest({ lists, owner }: { lists: (Access | null | undefined)[]; owner: string | undefined }): Promise<Access | undefined> {
    const mine = lists.filter((each): each is Access => !!each && (!owner || each.owner === owner)).sort((a, b) => b.version - a.version)
    for (const each of mine) if (await verify(each)) return each
    return undefined
  }

  async function signed({ owner, list }: { owner: Owner; list: Unsigned }): Promise<Access> {
    signedLast = { ...list, signature: await owner.sign(canonical(list)) }
    return signedLast
  }

  async function reconcile({ owner, best, rows }: { owner: Owner; best: Access | undefined; rows: { computer: StoredComputer; online: boolean; value: Held | undefined }[] }): Promise<Access | undefined> {
    if (!rows.some((row) => row.online)) return best
    const known = await Promise.all(rows.map(async (row): Promise<AccessComputer[]> => {
      if (row.value) return [{ id: await computerId(row.value.key), name: row.computer.name, key: row.value.key }]
      return best?.computers.filter((each) => each.name === row.computer.name) ?? []
    }))
    const computers = known.flat()
    if (best && JSON.stringify(best.computers) === JSON.stringify(computers)) return best
    const clients = best?.clients ?? [{ ...owner.self, addedAt: new Date().toISOString() }]
    return signed({ owner, list: { object: 'access', owner: owner.key, version: (best?.version ?? 0) + 1, clients, computers } })
  }

  async function carry({ list, rows }: { list: Access; rows: { computer: StoredComputer; online: boolean; value: Held | undefined }[] }): Promise<void> {
    const behind = rows.filter((row) => row.online && (!row.value?.access || row.value.access.owner !== list.owner || row.value.access.version < list.version))
    await Promise.all(behind.map(async (row) => {
      const saved = await call({ computer: row.computer, path: '/api/access', method: 'PUT', body: list, schema: Access }).catch(() => undefined)
      if (saved && row.value) accessSeen.set(row.computer.id, { ...row.value, access: saved })
    }))
  }

  async function pass(): Promise<Access | undefined> {
    const mine = await platform.signed?.read()
    if (!mine) return undefined
    const rows = await across({ seen: accessSeen, read: held })
    const best = await newest({ lists: [mine, ...rows.map((row) => row.value?.access)], owner: mine.owner })
    if (!best) return undefined
    if (best.version > mine.version) await platform.signed?.save(best)
    await carry({ list: best, rows })
    return best
  }

  const access = {
    sync: (): Promise<Access | undefined> => syncing ??= serial(async () => {
      const owner = await platform.owner?.()
      if (!owner) return pass()
      const rows = await across({ seen: accessSeen, read: held })
      const best = await newest({ lists: [signedLast, ...rows.map((row) => row.value?.access)], owner: owner.key })
      const list = await reconcile({ owner, best, rows })
      if (list) await carry({ list, rows })
      return list
    }).finally(() => { syncing = undefined }),
    async list(): Promise<Device[]> {
      const owner = await platform.owner?.()
      const list = owner
        ? await access.sync()
        : await newest({ lists: (await across({ seen: accessSeen, read: held })).map((row) => row.value?.access), owner: undefined })
      const devices = (list?.clients ?? []).map((client) => ({ ...client, self: client.key === owner?.self.key }))
      return devices.sort((a, b) => Number(b.self) - Number(a.self))
    },
    async remove(key: string): Promise<Device[]> {
      const owner = await platform.owner?.()
      if (!owner) throw new RequestError({ message: 'Open the OpenHut app on your Mac to remove a device. Only it can sign the list.', status: 403 })
      if (key === owner.self.key) throw new RequestError({ message: 'This Mac can\'t remove itself.', status: 409 })
      const list = await access.sync()
      if (!list?.clients.some((client) => client.key === key)) throw new RequestError({ message: 'That device isn\'t on the list anymore. Refresh and try again.', status: 404 })
      await serial(async () => {
        const next = await signed({ owner, list: { ...list, version: list.version + 1, clients: list.clients.filter((client) => client.key !== key) } })
        await carry({ list: next, rows: await across({ seen: accessSeen, read: held }) })
      })
      return access.list()
    },
    async allow(device: Joined): Promise<Access> {
      const owner = await platform.owner?.()
      if (!owner) throw new RequestError({ message: 'Open the OpenHut app on your Mac to allow a device. Only it can sign the list.', status: 403 })
      const list = await access.sync()
      if (!list) throw new RequestError({ message: 'None of your computers is answering. Try again when one is back.', status: 409 })
      const there = device.kind === 'client' ? list.clients.some((each) => each.key === device.key) : list.computers.some((each) => each.key === device.key)
      if (there) return list
      const added = device.kind === 'client'
        ? { clients: [...list.clients, { key: device.key, name: device.name, addedAt: new Date().toISOString() }] }
        : { computers: [...list.computers, { id: await computerId(device.key), name: device.name, key: device.key }] }
      return serial(async () => {
        const next = await signed({ owner, list: { ...list, ...added, version: list.version + 1 } })
        await carry({ list: next, rows: await across({ seen: accessSeen, read: held }) })
        return next
      })
    },
  }

  async function tick() {
    const seen = JSON.stringify(await Promise.all([agents.list(), connections.list(), providers.list(), account.sync().catch(() => null), access.sync().catch(() => null)]))
    if (seen === last) return
    last = seen
    for (const listener of listeners) listener()
  }

  return {
    computers,
    agents,
    connections,
    providers,
    account,
    access,
    fetch: async (input: Where & { path: string; init?: RequestInit }): Promise<Response> => platform.transport('of' in input ? await homeOf(input.of) : await computer(input.computer))(input.path, input.init),
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      timer ??= setInterval(() => void tick().catch(() => undefined), POLL_MS)
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        clearInterval(timer)
        timer = undefined
      }
    },
  }
}

function signedIn({ admin, kind }: { admin: Admin | undefined; kind: Subscription }): string {
  const state = kind === 'claude' ? admin?.seat : admin?.codex
  if (!state?.set) return ''
  return state.updatedAt ?? new Date(0).toISOString()
}

export function mergeProviders(rows: ProviderRow[]): MergedProvider[] {
  return PROVIDERS.flatMap((info) => {
    const have = rows.filter((row) => row.online && row.providers.some((each) => each.id === info.id && each.connected))
    const lead = have[0]?.providers.find((each) => each.id === info.id) ?? rows.flatMap((row) => row.providers).find((each) => each.id === info.id)
    return lead ? [{ ...lead, computers: have.map((row) => row.computer) }] : []
  })
}

export function older({ version, than }: { version: string; than: string }): boolean {
  const [a, b] = [version, than].map((each) => each.split(/[.-]/).slice(0, 3).map(Number))
  const at = a.findIndex((part, index) => part !== b[index])
  return at >= 0 && a[at] < b[at]
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function signInKind(kind: Connection['kind']): (typeof SIGN_IN_KINDS)[number] {
  const found = SIGN_IN_KINDS.find((each) => each === kind)
  if (!found) throw new RequestError({ message: `A ${kind} connection has no sign-in to run.`, status: 409 })
  return found
}

function failure({ computer, status, payload }: { computer: StoredComputer; status: number; payload: unknown }): RequestError {
  const parsed = ApiError.safeParse(payload)
  if (!parsed.success) return new RequestError({ message: `${computer.name} answered ${status}. Try again in a moment.`, status })
  return new RequestError({ message: parsed.data.error.message, status, param: parsed.data.error.param })
}
