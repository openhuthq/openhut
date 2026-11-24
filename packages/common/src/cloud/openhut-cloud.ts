import type { ComputerKey as NoiseComputerKey, DeviceKey as NoiseDeviceKey, Handlers, Tunnel } from '@openhut/tunnel'
import type { Keyring, Kit } from '../keyring/keyring.ts'
import type { Opened, Value } from '../records/seal.ts'
import type { MemberListBody, Role } from './cloud.ts'
import type { SealedKind } from './rules.ts'
import type { JoinCode, Me } from './v1/identity.ts'
import type { JoinRequest } from './v1/trust.ts'

export type Store = {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}

export type DeviceIdentity = { id: string; sign: (bytes: Uint8Array) => Promise<Uint8Array>; noise: NoiseDeviceKey }
export type ComputerIdentity = { id: string; sign: (bytes: Uint8Array) => Promise<Uint8Array>; noise: NoiseComputerKey }

export type SignIn = { google: { returnTo: string } } | { googleCode: string; state: string } | { joinCode: string }
export type Redirect = { object: 'redirect'; url: string }
export type Knock = { team: string; faces: number[]; wait: () => Promise<'approved' | 'denied' | 'expired'> }

export type Device = {
  signIn: (input: SignIn) => Promise<Redirect | Me>
  me: () => Promise<Me | null>
  askToJoin: (input: { team: string; name: string; os: string; server?: boolean }) => Promise<Knock>
  open: (input: { team: string; computer?: string }) => Promise<Tunnel>
}

export type Records<K extends SealedKind = SealedKind> = {
  kind: K
  get: (id: string) => Promise<Opened | null>
  put: (input: { id: string; parent: string | null; value: Value | null }) => Promise<Opened>
  list: (input?: { parent?: string; after?: string }) => Promise<Opened[]>
  watch: (onChange: (record: Opened) => void) => () => void
}

export type Presence = { send: (body: Uint8Array) => void; close: () => void }

export type Team = {
  id: string
  members: () => Promise<MemberListBody>
  requests: () => Promise<JoinRequest[]>
  invite: (input: { email: string; role: Exclude<Role, 'owner'> }) => Promise<{ link: string; expiresAt: string }>
  approve: (input: { device: string; faces?: number[] }) => Promise<void>
  deny: (input: { device: string; why?: 'mismatch' | 'not-me' }) => Promise<void>
  remove: (input: { device: string; lost?: boolean }) => Promise<void>
  rotateKeys: () => Promise<void>
  records: <K extends SealedKind>(kind: K) => Records<K>
  presence: (onHere: (input: { from: string; body: Uint8Array }) => void) => Presence
}

export type Computer = Device & {
  serve: (handlers: Omit<Handlers, 'listed'>) => () => void
  team: (id: string) => Team
  joinCode: (team: string) => Promise<JoinCode>
  saveKit: () => Promise<Kit>
  deleteAccount: () => Promise<void>
}

export type OpenhutCloud = {
  device: (input: { url: string; key: DeviceIdentity; store: Store; fetch?: typeof globalThis.fetch }) => Device
  computer: (input: { url: string; key: ComputerIdentity; store: Store; keyring: Keyring; fetch?: typeof globalThis.fetch }) => Computer
}

export const TRUST_CALLS = ['serve', 'team', 'joinCode', 'saveKit', 'deleteAccount'] as const satisfies readonly Exclude<keyof Computer, keyof Device>[]
