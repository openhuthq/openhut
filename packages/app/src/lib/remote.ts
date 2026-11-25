import { webKey, type Tunnel, type TunnelSocket } from '@openhut/common/tunnel/index.ts'
import { ComputersOffline, openhutCloud } from '@openhut/common/cloud/openhut-cloud.ts'
import type { JoinCode } from '@openhut/common/cloud/v1/identity.ts'
import { toBase64 } from '@openhut/common/vault/public.ts'
import type { Channel } from '@/lib/live-socket'
import { inviteOf } from '../features/join/invite.ts'
import { accountStepOf, lastSeenOf, Offline } from './web-first-run.ts'
import { config } from './config.ts'

export const REMOTE = !config.local
const RETURN = '/signed-in'

// A background read found the person's Cloud computer paused. Not an error to show: sending a message wakes it.
export class CloudPaused extends Error {
  constructor() {
    super('Cloud is paused. It wakes when you send a message.')
  }
}
const PAUSED = ['asleep', 'stopping', 'waking']

// A new account has no computer until its first agent starts Cloud. Reads fail with this, and the App shows an empty start.
export class NoComputer extends Error {
  constructor() {
    super('No computer yet. Creating your first agent starts Cloud.')
  }
}

export class CloudOffline extends Error {
  constructor() {
    super('Can’t reach OpenHut Cloud. Check your internet. OpenHut keeps trying.')
  }
}

type Pair = { publicKey: CryptoKey; privateKey: CryptoKey }
type Keys = { signing: Pair; tunnel: Pair }
export type Invited = { workspace: string; team: string | null; from: string | null; email: string | null }
export type RemoteState = { step: 'signed-out'; invited: Invited | null } | { step: 'first-run'; email: string } | { step: 'waiting'; email: string; invited: Invited | null } | { step: 'over'; email: string; workspace: string } | { step: 'ready'; email: string; workspace: string; teammate: boolean }

let tunnel: Tunnel | undefined
let target: { team: string; computer?: string } | undefined
let reopening: Promise<Tunnel> | undefined
let cut = false
let fresh = false
const watchers = new Set<() => void>()

function setCut(now: boolean): void {
  if (cut === now) return
  cut = now
  for (const watcher of watchers) watcher()
}

function kv<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('openhut', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = run(open.result.transaction('kv', mode).objectStore('kv'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }
  })
}
const store = {
  get: <T>(key: string) => kv<T | undefined>('readonly', (each) => each.get(key)),
  set: async (key: string, value: unknown) => { await kv('readwrite', (each) => each.put(value, key)) },
}

async function keys(): Promise<Keys> {
  const saved = await store.get<Keys>('keys')
  if (saved) return saved
  const made = {
    signing: await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as Pair,
    tunnel: await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as Pair,
  }
  await store.set('keys', made)
  return made
}

const key = {
  async id() {
    const { signing, tunnel: box } = await keys()
    const raw = async (each: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', each))
    return toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
  },
  sign: async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', (await keys()).signing.privateKey, Uint8Array.from(bytes))),
  noise: async () => webKey((await keys()).tunnel),
}
const cloud = openhutCloud.device({ url: config.cloud, store, key })

function reachable(): Promise<boolean> {
  return fetch(`${config.cloud.replace(/\/$/, '')}/health`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false)
}

// Only a person's action wakes a paused Cloud computer (wake); live events, refetches and the reconnect timer don't.
function live(wake = false): Promise<Tunnel> {
  if (tunnel && !tunnel.failure) return Promise.resolve(tunnel)
  if (!target) return Promise.reject(fresh ? new NoComputer() : new Error('Not connected to your computer yet.'))
  reopening ??= cloud.open({ ...target, wake }).then((opened) => {
    setCut(false)
    return (tunnel = opened)
  }, async (err: unknown) => {
    const offline = !await reachable()
    setCut(offline)
    throw offline ? new CloudOffline() : err
  }).finally(() => { reopening = undefined })
  return reopening
}

export const remote = {
  deviceKey: (): Promise<string> => key.id(),
  cut: (): boolean => cut,
  watchCut(watcher: () => void): () => void {
    watchers.add(watcher)
    return () => watchers.delete(watcher)
  },
  reconnect: (): Promise<unknown> => live().catch(() => undefined),

  async signOut(): Promise<void> {
    const asked = await store.get<string | null>('asked')
    const me = asked ? await cloud.me().catch(() => null) : null
    const account = me ? accountStepOf(me, (await store.get<Invited | null>('invite'))?.workspace) : undefined
    if (asked && account && account.step !== 'first-run') await cloud.knock({ team: account.workspace }).cancel().catch(() => undefined)
    await store.set('session', undefined)
    await store.set('asked', null)
    await store.set('invite', null)
  },

  async signIn(): Promise<void> {
    const started = await cloud.signIn({ google: { returnTo: `${location.origin}${RETURN}` } }).catch(() => null)
    if (started?.object !== 'redirect') throw new Error('OpenHut Cloud didn’t start the sign-in. Try again.')
    location.assign(started.url)
  },

  async state(): Promise<RemoteState> {
    const back = new URL(location.href)
    const link = back.pathname === '/join' ? inviteOf(back.hash) : undefined
    if (link) await store.set('invite', { workspace: link.workspace, team: link.team ?? null, from: link.from ?? null, email: link.email ?? null } satisfies Invited)
    const code = back.pathname === RETURN ? back.searchParams.get('code') : null
    if (code) {
      await cloud.signIn({ googleCode: code, state: back.searchParams.get('state') ?? '' }).catch(() => null)
      history.replaceState(null, '', '/')
    }
    const invited = await store.get<Invited | null>('invite') ?? null
    const me = await cloud.me()
    if (!me && !await reachable()) throw new CloudOffline()
    if (!me) return { step: 'signed-out', invited }
    const account = accountStepOf(me, invited?.workspace)
    fresh = account.step === 'first-run'
    if (account.step === 'first-run') return { step: 'first-run', email: me.email }
    const { workspace } = account
    const ready = async (): Promise<RemoteState> => {
      await store.set('asked', null)
      if (invited?.workspace === workspace) await store.set('invite', null)
      return { step: 'ready', email: me.email, workspace, teammate: workspace !== me.home }
    }
    if (account.step === 'ready') return ready()
    if (await store.get<string | null>('asked') !== workspace) await remote.knock(workspace)
    const state = await cloud.knock({ team: workspace }).state()
    if (state.step === 'approved') return ready()
    return state.step === 'waiting' ? { step: 'waiting', email: me.email, invited } : { step: 'over', email: me.email, workspace }
  },

  async knock(workspace: string): Promise<void> {
    await cloud.knock({ team: workspace }).ask({ name: browserName(), os: 'web' })
    await store.set('asked', workspace)
  },

  me: () => cloud.me(),

  joinCode: (): Promise<JoinCode> => cloud.firstComputerCode(),

  startCloud: () => cloud.startCloud(),

  cloudComputer: () => cloud.cloudComputer(),

  async open(workspace: string): Promise<void> {
    target = { team: workspace }
    tunnel = undefined
    await live(true).catch((err: unknown) => {
      if (!(err instanceof ComputersOffline)) throw err
      const seen = Math.max(0, ...err.reasons.map((reason) => lastSeenOf(reason) ?? 0)) || null
      throw new Offline({ computer: err.names.length === 1 ? err.names[0] ?? null : null, seen })
    })
  },

  async fetch(path: string, init?: RequestInit, wake = false): Promise<Response> {
    const paused = async (err: unknown) => { throw err instanceof ComputersOffline && PAUSED.includes((await cloud.cloudComputer().catch(() => null))?.state ?? '') ? new CloudPaused() : err }
    return (await (wake ? live().catch(() => live(true)) : live().catch(paused))).fetch(path, init)
  },

  channel({ path, onLine, onClose }: { path: string; onLine: (line: string) => void; onClose: (code: number, reason: string) => void }): Channel {
    let socket: TunnelSocket | undefined
    let closed = false
    live().then((open) => {
      if (closed) return
      socket = open.socket(path)
      socket.onmessage = ({ data }) => onLine(typeof data === 'string' ? data : new TextDecoder().decode(data))
      socket.onclose = ({ code, reason }) => onClose(code, reason)
    }, () => onClose(1006, 'not connected'))
    return { send: (line) => socket?.readyState === 1 && socket.send(line), close: () => { closed = true; socket?.close() } }
  },
}

function browserName(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} (web)`
}
