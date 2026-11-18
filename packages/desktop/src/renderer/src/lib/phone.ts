import { useSyncExternalStore } from 'react'
import { connect, TunnelError, type Tunnel, type TunnelSocket } from '@openhut/tunnel'
import { Access, verify } from '@openhut/common/access/access.ts'
import type { Platform, StoredComputer } from '@openhut/client'
import { deviceKey, isPhone, onLink, openPage, phoneName, saved, UnlockCanceled, wipe, type DeviceKey } from '@/lib/native'
import { mayRetry, type Failed } from '@/lib/backoff'
import { fromPhone } from '@/lib/platform'

export type PhoneState = { status: 'loading' | 'join' | 'paired' | 'removed'; link: { code: string } | undefined }
type Held = { list: Access; relayUrl: string }
type Code = { computer: { id: string; key: string }; owner: string; secret: string; relayUrl: string }

const HEX = /^[0-9a-f]{64}$/
const listeners = new Set<() => void>()
const tunnels = new Map<string, Promise<Tunnel>>()
const failures = new Map<string, Failed & { error: unknown }>()
let state: PhoneState = { status: 'loading', link: undefined }
let held: Held | undefined
let key: Promise<DeviceKey | undefined> | undefined
let wiping: Promise<void> | undefined

function set(next: Partial<PhoneState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

async function load(): Promise<Held | undefined> {
  const [list, owner, relayUrl] = await Promise.all([saved.get('access'), saved.get('owner'), saved.get('relay')])
  if (!list || !owner || !relayUrl) return undefined
  const parsed = Access.safeParse(JSON.parse(list))
  if (!parsed.success || parsed.data.owner !== owner || !await verify(parsed.data)) return undefined
  return { list: parsed.data, relayUrl }
}

async function keep(next: Held): Promise<void> {
  held = next
  await Promise.all([saved.set('access', JSON.stringify(next.list)), saved.set('owner', next.list.owner), saved.set('relay', next.relayUrl)])
}

function myKey(): Promise<DeviceKey> {
  key ??= deviceKey()
  return key.then((found) => {
    if (found) return found
    key = undefined
    throw new Error('This phone couldn\'t make its key. Set a screen lock and try again.')
  }, (err: unknown) => {
    key = undefined
    throw err
  })
}

function tunnelTo(computer: StoredComputer): Promise<Tunnel> {
  const open = tunnels.get(computer.id)
  if (open) return open
  const failed = failures.get(computer.id)
  if (failed && !mayRetry({ now: Date.now(), failed })) return Promise.reject(failed.error)
  const target = held?.list.computers.find((each, index) => each.id === computer.id || (computer.id === 'local' && !index))
  if (!held || !target) return Promise.reject(new TunnelError({ type: 'closed', message: `${computer.name} isn't on this phone's list.` }))
  const relayUrl = held.relayUrl
  const made = myKey().then((mine) => connect({ relayUrl, computer: target, key: mine }))
  tunnels.set(computer.id, made)
  made.then(() => failures.delete(computer.id), (error: unknown) => { if (!(error instanceof UnlockCanceled)) failures.set(computer.id, { since: Date.now(), tries: (failed?.tries ?? 0) + 1, error }) })
  const forget = () => { if (tunnels.get(computer.id) === made) tunnels.delete(computer.id) }
  made.then(async (tunnel) => {
    for await (const _message of tunnel.control) continue
  }).finally(forget).catch(() => undefined)
  return made
}

async function removed(): Promise<void> {
  wiping ??= (async () => {
    for (const open of tunnels.values()) void open.then((tunnel) => tunnel.close(), () => undefined)
    tunnels.clear()
    failures.clear()
    held = undefined
    key = undefined
    await wipe()
    set({ status: 'removed', link: undefined })
  })().finally(() => { wiping = undefined })
  return wiping
}

export function parseCode(text: string): Code {
  const url = URL.canParse(text.trim()) ? new URL(text.trim()) : undefined
  const get = (name: string) => url?.searchParams.get(name) ?? ''
  const [id, computerKey, owner, secret, relayUrl] = ['c', 'k', 'o', 's', 'r'].map(get)
  const fine = url?.protocol === 'openhut:' && [id, computerKey, owner, secret].every((each) => HEX.test(each)) && /^wss?:\/\//.test(relayUrl)
  if (!fine) throw new Error('That isn\'t an OpenHut code. Open Settings › Your devices › Add a phone on your Mac and scan the code there.')
  return { computer: { id, key: computerKey }, owner, secret, relayUrl }
}

export async function join({ code, onDigits }: { code: string; onDigits: (digits: string) => void }): Promise<void> {
  const parsed = parseCode(code)
  if (held && held.list.owner !== parsed.owner) throw new Error('This code is from someone else\'s Mac. This phone belongs to yours: remove it there first.')
  const tunnel = await connect({
    relayUrl: parsed.relayUrl, computer: parsed.computer, key: await myKey(),
    invitation: { secret: parsed.secret, name: phoneName(), kind: 'client' },
  }).catch(() => { throw new Error('Your Mac didn\'t answer. Check that OpenHut is open there and try again.') })
  try {
    onDigits(tunnel.digits)
    for await (const message of tunnel.control) {
      if (message.type === 'declined') throw new Error('Your Mac said no to this phone, or the code ran out. Make a new code and scan it again.')
      if (message.type !== 'accepted') continue
      const list = Access.safeParse(message.access)
      const mine = await myKey()
      const me = Array.from(mine.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (!list.success || list.data.owner !== parsed.owner || !await verify(list.data) || !list.data.clients.some((each) => each.key === me)) {
        throw new Error('The answer from your Mac wasn\'t signed by the owner in the code, so this phone didn\'t join.')
      }
      await keep({ list: list.data, relayUrl: parsed.relayUrl })
      return
    }
    throw new Error('This code was already used or ran out. Make a new one on your Mac and scan it.')
  } finally {
    tunnel.close()
  }
}

export const phone = {
  enter: () => set({ status: 'paired', link: undefined }),
  forgetLink: () => set({ link: undefined }),
}

export async function phoneSocket({ computer, path }: { computer: string; path: string }): Promise<TunnelSocket> {
  const stored = (await phonePlatform.store.computers()).find((each) => each.id === computer)
  if (!stored) throw new TunnelError({ type: 'closed', message: 'That computer isn\'t on this phone\'s list.' })
  return (await tunnelTo(stored)).socket(path)
}

export function usePhone(): PhoneState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => state)
}

export const phonePlatform: Platform = {
  transport: (computer) => async (path, init) => {
    const tunnel = await tunnelTo(computer)
    return tunnel.fetch(path, init).catch(async (err: unknown) => {
      if (err instanceof TunnelError && err.type === 'removed') await removed()
      throw err
    })
  },
  store: {
    computers: async () => (held?.list.computers ?? []).map((each, index) => ({ id: index ? each.id : 'local', name: fromPhone(each.name), url: '' })),
    add: () => Promise.reject(new Error('Add computers from the OpenHut app on your Mac.')),
    adopt: () => Promise.reject(new Error('Add computers from the OpenHut app on your Mac.')),
    remove: () => Promise.reject(new Error('Remove computers from the OpenHut app on your Mac.')),
  },
  openUrl: openPage,
  signed: {
    read: async () => held?.list,
    save: async (list) => { if (held) await keep({ ...held, list }) },
  },
}

if (isPhone()) {
  void load().then((found) => {
    held = found
    set({ status: found ? 'paired' : 'join' })
  }, () => set({ status: 'join' }))
  onLink((url) => { if (url.startsWith('openhut://join')) set({ link: { code: url } }) })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') failures.clear() })
}
