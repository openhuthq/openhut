import { recordsClient } from '../../src/records/client.ts'
import { signer, type Keyring, type Keys, type Where } from '../../src/records/seal.ts'
import type { Roster } from '../../src/records/allowed.ts'
import { Collection, PutSealed, type SealedRow } from '../../src/records/wire.ts'
import { identity, newKey, toBase64, type Bytes } from '../../src/vault/vault.ts'

export const team = 'ws_team_0001'
export const devices = {
  moMac: await identity(),
  moServer: await identity(),
  moPhone: await identity(),
  anaMac: await identity(),
  anaPhone: await identity(),
  gone: await identity(),
  stranger: await identity(),
}
export type Device = keyof typeof devices
export const keyOf = (device: Device): string => toBase64(devices[device].publicKey)

export const roster: Roster = {
  workspace: team,
  members: [
    { email: 'mo@example.com', role: 'owner', devices: [keyOf('moMac'), keyOf('moServer'), keyOf('moPhone')] },
    { email: 'ana@example.com', role: 'member', devices: [keyOf('anaMac'), keyOf('anaPhone')] },
  ],
  removed: [keyOf('gone')],
  runtimes: [keyOf('moServer')],
  viewers: [keyOf('moPhone'), keyOf('anaPhone')],
}

export const teamKeys: Keyring = { version: 2, keys: { 1: newKey(), 2: newKey() } }
const personal = { mo: { own: newKey(), vault: newKey() }, ana: { own: newKey(), vault: newKey() } }
const ring = (key: Bytes | undefined): Keyring | undefined => key && { version: 1, keys: { 1: key } }

export function keysOf(device: Device): Keys {
  const person = device.startsWith('mo') ? personal.mo : personal.ana
  const viewer = roster.viewers?.includes(keyOf(device)) ?? false
  return ({ use, workspace }) => ({ workspace: workspace === team ? teamKeys : undefined, own: ring(person.own), vault: viewer ? undefined : ring(person.vault) })[use]
}

export function signerOf(device: Device) {
  return signer(devices[device])
}

export function fakeCloud() {
  const rows = new Map<string, SealedRow>()
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const [, , name, id] = url.pathname.split('/')
    const collection = Collection.parse(name)
    if (init?.method === 'PUT') {
      const body = PutSealed.parse(JSON.parse(String(init.body)))
      const current = rows.get(`${collection}/${id}`)
      if (body.ver !== (current?.ver ?? 0) + 1) return reply(409, { error: { type: 'invalid_request_error', message: 'Someone else changed this record first.' }, current })
      const row = { id, object: collection, ...body }
      rows.set(`${collection}/${id}`, row)
      return reply(200, row)
    }
    const all = [...rows.values()].filter((row) => row.object === collection).sort((a, b) => a.id.localeCompare(b.id))
    if (init?.method === 'POST') {
      const { ids } = JSON.parse(String(init.body)) as { ids: string[] }
      return reply(200, { object: 'list', url: url.pathname, hasMore: false, data: all.filter((row) => ids.includes(row.id)) })
    }
    if (id) return rows.has(`${collection}/${id}`) ? reply(200, rows.get(`${collection}/${id}`)) : reply(404, { error: { type: 'invalid_request_error', message: 'No such record.' } })
    const after = url.searchParams.get('starting_after')
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const parent = url.searchParams.get('parent')
    const matching = all.filter((row) => row.workspace === url.searchParams.get('workspace') && (!parent || row.parent === parent) && (!after || row.id > after))
    return reply(200, { object: 'list', url: url.pathname, hasMore: matching.length > limit, data: matching.slice(0, limit) })
  }
  return { rows, fetch }
}

export function clientOf({ device, cloud, seen }: { device: Device; cloud: ReturnType<typeof fakeCloud>; seen?: (id: string) => { ver: number; parent: string | null } | undefined }) {
  return recordsClient({ baseUrl: 'https://api.test', token: () => 'token', device: signerOf(device), keys: keysOf(device), roster: (ws) => ws === team ? roster : undefined, seen, fetch: cloud.fetch })
}

export const agentWhere = (id = 'ag_shared1', owner = 'mo@example.com'): Where => ({ collection: 'agent', workspace: team, parent: owner, id })
