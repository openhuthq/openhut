import { connect, serve, TunnelError, type ComputerKey as NoiseComputerKey, type DeviceKey as NoiseDeviceKey, type Handlers, type Tunnel } from '@openhut/tunnel'
import * as z from 'zod/mini'
import { ApiError } from '../api.ts'
import { OAuthAuthorization, OAuthToken, type CreateOAuthAuthorization, type CreateOAuthToken } from './oauth.ts'
import { fromBase64, toBase64 } from '../vault/public.ts'
import { Letter, MemberList, OpenedInvite, type NewInvite } from './cloud.ts'
import { ENDPOINTS, pathOf, SignInStarted, type EndpointName } from './endpoints.ts'
import { commitOfWeb, facesOfWeb } from './faces-web.ts'
import { bodyOf } from './member-list.ts'
import { recordsClient, type RecordsOptions } from './records.ts'
import type { Kind } from './rules.ts'
import { JoinCode, KeyBox, Me, proofOf, requestParts, Session, SIGNATURE_HEADER, type NamedKeyBox, type V1Proof } from './v1/identity.ts'
import { JoinRequest, type NewLetter, type PostMemberList } from './v1/trust.ts'

export type Store = {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}
export type Signer = { id: () => Promise<string>; sign: (bytes: Uint8Array) => Promise<Uint8Array> }
export type DeviceIdentity = Signer & { noise: () => Promise<NoiseDeviceKey> }
export type ComputerIdentity = Signer & { noise: () => Promise<NoiseComputerKey> }
export type Fetch = typeof globalThis.fetch
export type Url = string | (() => string)
export type Reply = { status: number; json: unknown }

export type SignIn = { google: { returnTo: string; state?: string } } | { googleCode: string; state?: string } | { joinCode: string }
export type Redirect = { object: 'redirect'; url: string }
export type SignedIn = Me & { maker?: string }
export type KnockState = { step: 'approved' } | { step: 'waiting'; faces: number[] } | { step: 'over'; missed: boolean }
export type Knock = { team: string; reveal: () => Promise<boolean>; ask: (input: { name: string; os: string; server?: boolean }) => Promise<JoinRequest>; mine: () => Promise<JoinRequest | undefined>; state: () => Promise<KnockState>; cancel: () => Promise<void> }
export type Watch = { send: (input: { type: 'presence' | 'beat'; workspace: string; body: string }) => void; close: () => void }
export type WatchSocket = { send: (text: string) => void; close: () => void; addEventListener: (type: 'open' | 'message', listener: (event: { data?: unknown }) => void) => void }

export type Device = {
  signIn: (input: SignIn) => Promise<Redirect | SignedIn>
  me: () => Promise<Me | null>
  firstComputerCode: () => Promise<JoinCode>
  knock: (input: { team: string; nonce: string }) => Knock
  open: (input: { team: string; computer?: string; timeout?: number } | { box: string; timeout?: number }) => Promise<Tunnel>
}

export type Team = {
  id: string
  lists: (input?: { after?: number }) => Promise<MemberList[]>
  publish: (change: PostMemberList) => Promise<Reply>
  requests: () => Promise<JoinRequest[]>
  review: (device: string) => Promise<Reply>
  deny: (input: { device: string; why?: 'mismatch' | 'not-me' }) => Promise<Reply>
  letters: () => Promise<Letter[]>
  send: (letter: NewLetter & { id?: string }) => Promise<Reply>
  take: (id: string) => Promise<Reply>
  invite: (invite: NewInvite) => Promise<Reply>
  openInvite: (input: { id: string; after?: number }) => Promise<OpenedInvite | Reply>
}

export type Computer = Device & {
  serve: (handlers: Handlers) => () => void
  team: (id: string) => Team
  joinCode: () => Promise<JoinCode>
  deleteAccount: () => Promise<Reply>
  keyBoxes: {
    list: () => Promise<KeyBox[] | null>
    get: (name: string) => Promise<Reply>
    put: (box: NamedKeyBox) => Promise<Reply>
    drop: (input: { name: string; by: string; signature: string }) => Promise<Reply>
  }
  watch: (input: { socket: (url: string) => WatchSocket; onMessage: (text: string) => void; onHello?: (error?: unknown) => void }) => Watch
  records: (options: RecordsOptions) => ReturnType<typeof recordsClient>
  oauth: { authorize: (body: CreateOAuthAuthorization) => Promise<OAuthAuthorization>; token: (body: CreateOAuthToken) => Promise<OAuthToken> }
}

export const TRUST_CALLS = ['serve', 'team', 'joinCode', 'deleteAccount', 'watch', 'oauth'] as const satisfies readonly Exclude<keyof Computer, keyof Device>[]

export class CloudError extends Error {
  readonly status: number
  readonly json: unknown
  constructor({ status, json, message }: { status: number; json: unknown; message?: string }) {
    super(message ?? ApiError.safeParse(json).data?.error.message ?? (status ? `OpenHut Cloud answered HTTP ${status}.` : 'OpenHut Cloud didn’t answer. Check this device’s internet connection.'))
    this.status = status
    this.json = json
  }
}

export class ComputersOffline extends Error {
  readonly names: (string | null)[]
  readonly reasons: string[]
  constructor({ names, reasons }: { names: (string | null)[]; reasons: string[] }) {
    super('None of your computers is online. Open OpenHut on your Mac, then try again.')
    this.names = names
    this.reasons = reasons
  }
}

const REFRESH_EARLY_MS = 5 * 60_000
const TIMEOUT_MS = 20_000
const Page = z.object({ data: z.array(z.unknown()), hasMore: z.optional(z.boolean()) })

type Call = { name: EndpointName; params?: Record<string, string>; query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean | 'optional' }

function wire({ url, key, store, fetch: send = globalThis.fetch }: { url: Url; key: Signer; store: Store; fetch?: Fetch }) {
  const base = () => (typeof url === 'function' ? url() : url).replace(/\/$/, '')
  let renewing: Promise<Session | undefined> | undefined

  const sign = async (proof: V1Proof, parts: string[]) => toBase64(await key.sign(proofOf({ proof, parts })))

  async function raw({ name, params, query, body, token }: Omit<Call, 'auth'> & { token?: string }): Promise<Reply> {
    const endpoint = ENDPOINTS[name]
    const search = new URLSearchParams(Object.entries(query ?? {}).flatMap(([field, value]) => value === undefined ? [] : [[field, String(value)]])).toString()
    const path = `${pathOf({ name, params })}${search ? `?${search}` : ''}`
    const payload = body === undefined ? '' : JSON.stringify(body)
    const headers: Record<string, string> = { ...payload && { 'content-type': 'application/json' }, ...token && { authorization: `Bearer ${token}` } }
    if (token && endpoint.method !== 'GET') {
      const signedAt = Date.now()
      headers[SIGNATURE_HEADER] = `${signedAt}.${await sign('request', await requestParts({ method: endpoint.method, path, signedAt, body: payload }))}`
    }
    const response = await send(`${base()}${path}`, { method: endpoint.method, headers, body: payload || undefined, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null)
    if (!response) return { status: 0, json: null }
    return { status: response.status, json: await response.json().catch(() => null) }
  }

  async function session(): Promise<Session | undefined> {
    const saved = await store.get<Session>('session')
    if (!saved || Date.parse(saved.expiresAt) - Date.now() > REFRESH_EARLY_MS) return saved
    renewing ??= renew(saved).finally(() => { renewing = undefined })
    return renewing
  }

  async function renew(saved: Session): Promise<Session | undefined> {
    const signedAt = Date.now()
    const reply = await raw({ name: 'createSession', body: { grant: 'refresh_token', refreshToken: saved.refreshToken, signedAt, signature: await sign('refresh', [saved.refreshToken, String(signedAt)]) } })
    const fresh = Session.safeParse(reply.json).data
    if (fresh) await store.set('session', fresh)
    else if (reply.status === 401 || reply.status === 400) await store.set('session', undefined)
    return fresh ?? (reply.status === 0 ? saved : undefined)
  }

  async function call({ auth = true, ...input }: Call): Promise<Reply> {
    if (!auth) return raw(input)
    const held = await session()
    if (!held && auth === 'optional') return raw(input)
    if (!held) return { status: 401, json: { error: { type: 'invalid_request_error', message: 'Sign in to OpenHut first.' } } }
    return raw({ ...input, token: held.token })
  }

  async function ok<T>(input: Call & { reply: z.ZodMiniType<T> }): Promise<T> {
    const answer = await call(input)
    const parsed = input.reply.safeParse(answer.json)
    if (answer.status >= 200 && answer.status < 300 && parsed.success) return parsed.data
    throw new CloudError(answer)
  }

  async function start({ grant, code }: { grant: 'google' | 'join_code'; code: string }): Promise<SignedIn> {
    const body = grant === 'google' ? { grant, code, signature: await sign('session', [code]) } : { grant, code, device: await key.id(), signature: await sign('session', [code]) }
    const made = await ok({ name: 'createSession', body, auth: false, reply: Session })
    await store.set('session', made)
    return { ...await ok({ name: 'me', reply: Me }), ...made.maker && { maker: made.maker } }
  }

  return { call, ok, start, session, sign, base, token: async () => (await session())?.token ?? '' }
}

export type Wire = ReturnType<typeof wire>

function deviceOf({ key, store, net }: { key: DeviceIdentity; store: Store; net: Wire }): Device {
  const sockets = () => net.base().replace(/^http/, 'ws')

  async function computersOf(team: string): Promise<{ device: string; name: string | null }[]> {
    const signedIn = await net.session()
    const me = await key.id()
    const lists = await listsOf({ net, team })
    const body = bodyOf(lists.at(-1))
    const mine = body?.members.find((each) => each.email === signedIn?.email)
    const devices = mine?.devices.filter((device) => device !== me && device !== mine.kit && !body?.removed.includes(device) && !(mine.viewers ?? []).includes(device)) ?? []
    return devices.map((device) => ({ device, name: body?.names?.[device] ?? null }))
  }

  return {
    async signIn(input) {
      if ('joinCode' in input) return net.start({ grant: 'join_code', code: input.joinCode })
      if ('googleCode' in input) {
        if (input.state !== undefined && input.state !== await store.get<string>('sign-in-state')) throw new CloudError({ status: 400, json: null, message: 'This sign-in didn’t start here. Start it again.' })
        await store.set('sign-in-state', undefined)
        return net.start({ grant: 'google', code: input.googleCode })
      }
      const state = input.google.state ?? toBase64(crypto.getRandomValues(new Uint8Array(16)))
      if (!input.google.state) await store.set('sign-in-state', state)
      const started = await net.ok({ name: 'startSignIn', auth: false, body: { device: await key.id(), returnTo: input.google.returnTo, state }, reply: SignInStarted })
      return { object: 'redirect', url: started.url }
    },

    async me() {
      const reply = await net.call({ name: 'me' })
      return reply.status === 200 ? Me.safeParse(reply.json).data ?? null : null
    },

    firstComputerCode: () => net.ok({ name: 'createJoinCode', reply: JoinCode }),

    knock({ team, nonce }) {
      const mine = async () => {
        const me = await key.id()
        return (await requestsOf({ net, team })).find((each) => each.id === me)
      }
      const reveal = async () => (await net.call({ name: 'putRecord', params: { team, kind: 'join-request', id: await key.id() }, body: { nonce } })).status === 200
      return {
        team,
        mine,
        reveal,
        async ask({ name, os, server = false }) {
          const me = await key.id()
          return net.ok({ name: 'putRecord', params: { team, kind: 'join-request', id: me }, body: { name, os, server, commit: await commitOfWeb({ device: me, nonce }) }, reply: JoinRequest })
        },
        async state() {
          const me = await net.ok({ name: 'me', reply: Me })
          if (me.workspaces.some((each) => each.id === team && each.access === 'listed')) return { step: 'approved' }
          const asked = await mine()
          if (!asked?.asked) return { step: 'over', missed: Boolean(asked?.missed) }
          if (asked.reviewed && !asked.nonce) await reveal()
          return { step: 'waiting', faces: await facesOfWeb({ device: asked.id, nonce }) }
        },
        async cancel() {
          await net.call({ name: 'deleteRecord', params: { team, kind: 'join-request', id: await key.id() } })
        },
      }
    },

    async open(input) {
      const token = await net.token()
      const noise = await key.noise()
      const { timeout = 8000 } = input
      const computers = 'box' in input ? [] : input.computer ? [{ device: input.computer, name: null }] : await computersOf(input.team)
      const boxes = 'box' in input ? [fromHex(input.box)] : computers.map(({ device }) => fromBase64(device).subarray(32))
      const reasons: string[] = []
      for (const box of boxes) {
        const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', box)))
        const opened = await connect({ relayUrl: sockets(), url: `${sockets()}${pathOf({ name: 'tunnel', params: { computer: id } })}?role=device`, computer: { id, key: hex(box) }, key: noise, token, timeout }).catch((error: unknown) => {
          if (error instanceof TunnelError && error.reason) reasons.push(error.reason)
          return undefined
        })
        if (opened) return opened
      }
      throw new ComputersOffline({ names: computers.map(({ name }) => name), reasons })
    },
  }
}

async function listsOf({ net, team, after = 0 }: { net: Wire; team: string; after?: number }): Promise<MemberList[]> {
  const out: MemberList[] = []
  for (let from = after; ;) {
    const reply = await net.call({ name: 'listRecords', params: { team, kind: 'member-list' }, query: { after: from } })
    const page = reply.status === 200 ? Page.safeParse(reply.json).data : undefined
    if (!page) throw new CloudError(reply)
    const lists = page.data.flatMap((each) => MemberList.safeParse(each).data ?? [])
    out.push(...lists)
    const last = bodyOf(lists.at(-1))
    if (!page.hasMore || !last) return out
    from = last.version
  }
}

async function requestsOf({ net, team }: { net: Wire; team: string }): Promise<JoinRequest[]> {
  const page = Page.safeParse((await net.call({ name: 'listRecords', params: { team, kind: 'join-request' } })).json).data
  return (page?.data ?? []).flatMap((each) => JoinRequest.safeParse(each).data ?? [])
}

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function teamOf({ net, id }: { net: Wire; id: string }): Team {
  const record = (kind: Kind, record: string) => ({ team: id, kind, id: record })
  return {
    id,
    lists: ({ after } = {}) => listsOf({ net, team: id, after }),
    publish: (change) => net.call({ name: 'putRecord', params: record('member-list', String(bodyOf(change.list)?.version ?? 0)), body: change }),
    requests: () => requestsOf({ net, team: id }),
    review: (device) => net.call({ name: 'putRecord', params: record('join-request', device), body: { reviewed: true } }),
    deny: ({ device, why }) => net.call({ name: 'deleteRecord', params: record('join-request', device), query: { why } }),
    async letters() {
      const reply = await net.call({ name: 'listRecords', params: { team: id, kind: 'letter' } })
      const page = reply.status === 200 ? Page.safeParse(reply.json).data : undefined
      if (!page) throw new CloudError(reply)
      return page.data.flatMap((each) => Letter.safeParse(each).data ?? [])
    },
    send: ({ id: letter = toBase64(crypto.getRandomValues(new Uint8Array(16))), ...body }) => net.call({ name: 'putRecord', params: record('letter', letter), body }),
    take: (letter) => net.call({ name: 'deleteRecord', params: record('letter', letter) }),
    invite: ({ id: invite, ...body }: NewInvite) => net.call({ name: 'putRecord', params: record('invite', invite), body }),
    async openInvite({ id: invite, after }) {
      const reply = await net.call({ name: 'getRecord', params: record('invite', invite), query: { after } })
      return OpenedInvite.safeParse(reply.json).data ?? reply
    },
  }
}

function computerOf({ url, key, store, fetch }: { url: Url; key: ComputerIdentity; store: Store; fetch?: Fetch }): Computer {
  const net = wire({ url, key, store, fetch })
  const sockets = () => net.base().replace(/^http/, 'ws')
  const onHome = async (step: (team: string) => Promise<Reply>): Promise<Reply> => {
    const me = await net.call({ name: 'me' })
    const home = Me.safeParse(me.json).data?.home
    return home ? step(home) : me.status === 200 ? { status: 404, json: null } : me
  }
  return {
    ...deviceOf({ key: { ...key, noise: async () => key.noise() }, store, net }),

    serve(handlers) {
      let stop: { close: () => void } | undefined
      let stopped = false
      void key.noise().then(async (noise) => {
        const computerId = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(noise.publicKey))))
        if (!stopped) stop = serve({ ...handlers, relayUrl: sockets(), computerId, key: noise, token: net.token })
      })
      return () => {
        stopped = true
        stop?.close()
      }
    },

    team: (id) => teamOf({ net, id }),
    joinCode: () => net.ok({ name: 'createJoinCode', reply: JoinCode }),
    deleteAccount: () => net.call({ name: 'deleteMe' }),

    keyBoxes: {
      async list() {
        const reply = await onHome((team) => net.call({ name: 'listRecords', params: { team, kind: 'key-box' } }))
        const page = reply.status === 200 ? Page.safeParse(reply.json).data : undefined
        return page ? page.data.flatMap((each) => KeyBox.safeParse(each).data ?? []) : null
      },
      get: (box) => onHome((team) => net.call({ name: 'getRecord', params: { team, kind: 'key-box', id: box } })),
      put: ({ name: box, ...body }) => onHome((team) => net.call({ name: 'putRecord', params: { team, kind: 'key-box', id: box }, body })),
      drop: ({ name: box, ...body }) => onHome((team) => net.call({ name: 'deleteRecord', params: { team, kind: 'key-box', id: box }, body })),
    },

    watch({ socket, onMessage, onHello }) {
      const opened = socket(`${sockets()}${pathOf({ name: 'watch' })}`)
      opened.addEventListener('open', () => {
        net.token().then((token) => {
          opened.send(JSON.stringify({ type: 'hello', token }))
          onHello?.()
        }, (error: unknown) => onHello?.(error))
      })
      opened.addEventListener('message', (event) => onMessage(String(event.data)))
      return { send: (message) => opened.send(JSON.stringify(message)), close: () => opened.close() }
    },

    records: (options) => recordsClient({ ...options, send: ({ method, workspace, kind, id: row, query, body }) => net.call({ name: method === 'PUT' ? 'putRecord' : row === undefined ? 'listRecords' : 'getRecord', params: { team: workspace, kind, ...row !== undefined && { id: row } }, query, body }) }),

    oauth: {
      authorize: (body) => net.ok({ name: 'createOAuthAuthorization', body, auth: 'optional', reply: OAuthAuthorization }),
      token: (body) => net.ok({ name: 'createOAuthToken', body, auth: 'optional', reply: OAuthToken }),
    },
  }
}

export const openhutCloud = {
  device: ({ url, key, store, fetch }: { url: Url; key: DeviceIdentity; store: Store; fetch?: Fetch }): Device => deviceOf({ key, store, net: wire({ url, key, store, fetch }) }),
  computer: computerOf,
}

