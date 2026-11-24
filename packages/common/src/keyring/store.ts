import * as z from 'zod/mini'
import { MemberList } from '../cloud/cloud.ts'

export const KIT = z.object({ box: z.string(), savedAt: z.string(), confirmed: z.optional(z.boolean()) })
export const Keys = z.object({ key: z.string(), version: z.number(), old: z.optional(z.record(z.string(), z.string())), slot: z.optional(z.string()), own: z.optional(z.string()) })
export const Room = z.object({ workspace: z.object({ id: z.string(), ...Keys.shape }), list: MemberList, first: z.optional(MemberList) })
export const Stored = z.object({
  device: z.string(),
  machine: z.string(),
  account: z.optional(z.object({ sub: z.string(), email: z.string(), key: z.string(), vault: z.optional(z.string()), ...Room.shape, teams: z.optional(z.array(Room)), links: z.optional(z.record(z.string(), z.string())), linksUntil: z.optional(z.record(z.string(), z.string())), joinedBy: z.optional(z.record(z.string(), z.string())) })),
  kit: z.optional(KIT),
  locked: z.optional(z.object({ sub: z.string(), email: z.string() })),
  session: z.optional(z.object({ token: z.string(), refresh: z.optional(z.string()), expiresAt: z.string() })),
  asking: z.optional(z.array(z.object({ id: z.string(), admins: z.array(z.string()), own: z.optional(z.boolean()), nonce: z.optional(z.string()) }))),
})
export type Stored = z.infer<typeof Stored>
export type Account = NonNullable<Stored['account']>
export type Session = NonNullable<Stored['session']>
export type AskRoom = NonNullable<Stored['asking']>[number]
export type Room = z.infer<typeof Room>

export type KeyStore = {
  machine: string
  kind: () => 'keychain' | 'file'
  current: () => Stored | undefined
  read: () => Promise<Stored>
  write: (next: Stored) => Promise<void>
}

let held: { store: KeyStore; deviceName: () => string } | undefined

export function useStore(input: { store: KeyStore; deviceName: () => string }): void {
  held = input
}

function store(): KeyStore {
  if (!held) throw new Error('Open the keyring with a store first.')
  return held.store
}

export const keyStore = {
  get machine(): string {
    return store().machine
  },
  kind: (): 'keychain' | 'file' => store().kind(),
  current: (): Stored | undefined => held?.store.current(),
  read: (): Promise<Stored> => store().read(),
  write: (next: Stored): Promise<void> => store().write(next),
}

export function deviceName(): string {
  return held?.deviceName() || ''
}
