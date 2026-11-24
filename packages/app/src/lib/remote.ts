import { webKey, type Tunnel } from '@openhut/common/tunnel/index.ts'
import { ComputersOffline, openhutCloud } from '@openhut/common/cloud/openhut-cloud.ts'
import type { JoinCode } from '@openhut/common/cloud/v1/identity.ts'
import { toBase64 } from '@openhut/common/vault/public.ts'
import type { Channel } from '@/lib/live-socket'
import { accountStepOf, lastSeenOf, Offline } from './web-first-run.ts'
import { config } from './config.ts'

export const REMOTE = !config.local
const RETURN = '/signed-in'

type Pair = { publicKey: CryptoKey; privateKey: CryptoKey }
type Keys = { signing: Pair; tunnel: Pair }
export type RemoteState = { step: 'signed-out' } | { step: 'first-run'; email: string } | { step: 'waiting'; email: string; faces: number[] } | { step: 'over'; email: string; missed: boolean } | { step: 'ready'; email: string; workspace: string }

let tunnel: Tunnel | undefined

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

const cloud = openhutCloud.device({
  url: config.cloud,
  store,
  key: {
    async id() {
      const { signing, tunnel: box } = await keys()
      const raw = async (key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
      return toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
    },
    sign: async (bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', (await keys()).signing.privateKey, Uint8Array.from(bytes))),
    noise: async () => webKey((await keys()).tunnel),
  },
})

export const remote = {
  async signIn(): Promise<void> {
    const started = await cloud.signIn({ google: { returnTo: `${location.origin}${RETURN}` } }).catch(() => null)
    if (started?.object !== 'redirect') throw new Error('OpenHut Cloud didn’t start the sign-in. Try again.')
    location.assign(started.url)
  },

  async state(): Promise<RemoteState> {
    const back = new URL(location.href)
    const code = back.pathname === RETURN ? back.searchParams.get('code') : null
    if (code) {
      await cloud.signIn({ googleCode: code, state: back.searchParams.get('state') ?? '' }).catch(() => null)
      history.replaceState(null, '', '/')
    }
    const me = await cloud.me()
    if (!me) return { step: 'signed-out' }
    const step = accountStepOf(me)
    if (step === 'first-run') return { step, email: me.email }
    if (step === 'ready') {
      await store.set('nonce', null)
      return { step: 'ready', email: me.email, workspace: me.home ?? '' }
    }
    if (!await store.get<string | null>('nonce')) await remote.knock(me.home ?? undefined)
    const state = await cloud.knock({ team: me.home ?? '', nonce: await store.get<string>('nonce') ?? '' }).state()
    if (state.step === 'approved') return { step: 'ready', email: me.email, workspace: me.home ?? '' }
    return state.step === 'waiting' ? { step: 'waiting', email: me.email, faces: state.faces } : { step: 'over', email: me.email, missed: state.missed }
  },

  async knock(workspace?: string): Promise<void> {
    const home = workspace ?? (await cloud.me())?.home ?? ''
    const nonce = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    await cloud.knock({ team: home, nonce }).ask({ name: browserName(), os: 'web' })
    await store.set('nonce', nonce)
  },

  joinCode: (): Promise<JoinCode> => cloud.firstComputerCode(),

  async open(workspace: string): Promise<void> {
    tunnel = await cloud.open({ team: workspace }).catch((err: unknown) => {
      if (!(err instanceof ComputersOffline)) throw err
      const seen = Math.max(0, ...err.reasons.map((reason) => lastSeenOf(reason) ?? 0)) || null
      throw new Offline({ computer: err.names.length === 1 ? err.names[0] ?? null : null, seen })
    })
  },

  fetch(path: string, init?: RequestInit): Promise<Response> {
    if (!tunnel) return Promise.reject(new Error('Not connected to your computer yet.'))
    return tunnel.fetch(path, init)
  },

  channel({ path, onLine, onClose }: { path: string; onLine: (line: string) => void; onClose: (code: number, reason: string) => void }): Channel {
    if (!tunnel) {
      setTimeout(() => onClose(1006, 'not connected'))
      return { send: () => undefined, close: () => undefined }
    }
    const socket = tunnel.socket(path)
    socket.onmessage = ({ data }) => onLine(typeof data === 'string' ? data : new TextDecoder().decode(data))
    socket.onclose = ({ code, reason }) => onClose(code, reason)
    return { send: (line) => socket.readyState === 1 && socket.send(line), close: () => socket.close() }
  },
}

function browserName(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} (web)`
}
