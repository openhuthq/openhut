import { connect, webKey, type Tunnel } from '@openhut/tunnel'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import type { MemberList } from '@openhut/common/cloud/cloud.ts'
import { proofOf, requestParts, SIGNATURE_HEADER, type Me, type Session } from '@openhut/common/cloud/v1/identity.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/vault.ts'
import type { Channel } from '@/lib/live-socket'

const env: Partial<ImportMetaEnv> = import.meta.env ?? {}
export const REMOTE = env.MODE === 'web'
const API = env.VITE_OPENHUT_API_URL ?? 'https://cloud.openhut.dev/api'
const RELAY = env.VITE_OPENHUT_RELAY_URL ?? 'wss://cloud.openhut.dev'
const RETURN = '/signed-in'

type Pair = { publicKey: CryptoKey; privateKey: CryptoKey }
type Keys = { signing: Pair; tunnel: Pair }
export type RemoteState = { step: 'signed-out' } | { step: 'waiting'; email: string } | { step: 'ready'; email: string; workspace: string }

let tunnel: Tunnel | undefined

function store<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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
const read = <T>(key: string) => store<T | undefined>('readonly', (kv) => kv.get(key))
const write = (key: string, value: unknown) => store('readwrite', (kv) => kv.put(value, key))

async function keys(): Promise<Keys> {
  const saved = await read<Keys>('keys')
  if (saved) return saved
  const made = {
    signing: await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as Pair,
    tunnel: await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as Pair,
  }
  await write('keys', made)
  return made
}

async function deviceOf({ signing, tunnel: box }: Keys): Promise<string> {
  const raw = async (key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
}

async function sign(bytes: Uint8Array): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', (await keys()).signing.privateKey, Uint8Array.from(bytes))))
}

async function session(): Promise<Session | undefined> {
  const saved = await read<Session>('session')
  if (!saved || Date.parse(saved.expiresAt) - Date.now() > 60_000) return saved
  const signedAt = Date.now()
  const renewed = await fetch(`${API}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: 'refresh_token', refreshToken: saved.refreshToken, signedAt, signature: await sign(proofOf({ proof: 'refresh', parts: [saved.refreshToken, String(signedAt)] })) }) })
  if (!renewed.ok) return undefined
  const fresh: Session = await renewed.json()
  await write('session', fresh)
  return fresh
}

async function cloud<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const signed = await session()
  if (!signed) return { status: 401, json: null as T }
  const payload = body === undefined ? '' : JSON.stringify(body)
  const headers: Record<string, string> = { authorization: `Bearer ${signed.token}`, 'content-type': 'application/json' }
  if (method !== 'GET') {
    const signedAt = Date.now()
    headers[SIGNATURE_HEADER] = `${signedAt}.${await sign(proofOf({ proof: 'request', parts: await requestParts({ method, path, signedAt, body: payload }) }))}`
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload || undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}

export const remote = {
  async signIn(): Promise<void> {
    const state = toBase64(crypto.getRandomValues(new Uint8Array(16)))
    sessionStorage.setItem('openhut-state', state)
    const res = await fetch(`${API}/v1/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google', device: await deviceOf(await keys()), redirectUrl: `${location.origin}${RETURN}`, state }) })
    if (!res.ok) throw new Error('OpenHut Cloud didn’t start the sign-in. Try again.')
    location.assign((await res.json() as { url: string }).url)
  },

  async state(): Promise<RemoteState> {
    const back = new URL(location.href)
    const code = back.pathname === RETURN ? back.searchParams.get('code') : null
    if (code && back.searchParams.get('state') === sessionStorage.getItem('openhut-state')) {
      const res = await fetch(`${API}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: 'google', code, signature: await sign(proofOf({ proof: 'session', parts: [code] })) }) })
      if (res.ok) await write('session', await res.json())
      history.replaceState(null, '', '/')
    }
    const me = await cloud<Me>('GET', '/v1/me')
    if (me.status !== 200) return { step: 'signed-out' }
    const home = me.json.workspaces.find((each) => each.id === me.json.home)
    if (home?.access === 'listed') return { step: 'ready', email: me.json.email, workspace: home.id }
    const asked = await cloud('POST', '/v1/join-requests', { workspace: me.json.home, name: browserName(), os: 'web' })
    if (asked.status !== 200 && asked.status !== 409) throw new Error('OpenHut Cloud didn’t take the request. Try again.')
    return { step: 'waiting', email: me.json.email }
  },

  async open(workspace: string): Promise<void> {
    const signed = await session()
    const lists = await cloud<{ data: MemberList[] }>('GET', `/v1/member-lists?workspace=${workspace}`)
    const body = bodyOf(lists.json?.data.at(-1))
    const mine = await deviceOf(await keys())
    const computers = body?.members.find((each) => each.email === signed?.email)?.devices.filter((device) => device !== mine && !body.removed.includes(device)) ?? []
    for (const device of computers) {
      const box = fromBase64(device).subarray(32)
      const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', box)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const key = Array.from(box, (byte) => byte.toString(16).padStart(2, '0')).join('')
      tunnel = await connect({ relayUrl: RELAY, computer: { id, key }, key: await webKey((await keys()).tunnel), token: signed?.token ?? '', timeout: 8000 }).catch(() => undefined)
      if (tunnel) return
    }
    throw new Error('None of your computers is online. Open OpenHut on your Mac, then try again.')
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
