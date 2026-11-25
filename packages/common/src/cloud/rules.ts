import { COLLECTIONS, type Collection } from '../records/wire.ts'

export const PARTIES = {
  listed: 'A device on this team’s member list',
  admin: 'A listed device of an owner or admin',
  knocking: 'A device of a member’s email that isn’t listed yet, or the member’s kit key',
  invited: 'A device signed in with an email this team has a live invite for',
  founder: 'A device of the person who made the team, before it has a member list',
  home: 'A device on the account’s home team list',
  fresh: 'A device that signed in with Google in the last 10 minutes',
  self: 'The device the record is about',
  own: 'A listed device of the same email as the record',
  recipient: 'The device the record is addressed to',
} as const
export type Party = keyof typeof PARTIES

export const CHECKS = {
  chain: 'Append-only signed chain: each version is signed by a key on the previous one; an owner changes anything, an admin all but the owner, a member only their own devices, an invite key adds its invitee, a kit key adds a device',
  'one-open': 'One open request per email',
  'read-once': 'Deleted once read',
  expires: 'Expires',
  'account-signed': 'Signed by the account key',
  monotonic: 'Monotonic version',
  'size-cap': 'Size cap; streamed to the volume',
  'not-stored': 'Never stored, only relayed; 8 KiB cap',
} as const
export type Check = keyof typeof CHECKS

export type Rule = { write: readonly Party[]; read: readonly Party[]; check: Check; stored: boolean }

const sealed: Rule = { write: ['listed'], read: ['listed'], check: 'monotonic', stored: true }

export const RULES = {
  'member-list': { write: ['listed', 'invited', 'knocking', 'founder'], read: ['listed', 'knocking', 'invited'], check: 'chain', stored: true },
  'join-request': { write: ['knocking', 'invited', 'own', 'admin'], read: ['self', 'own', 'admin'], check: 'one-open', stored: true },
  letter: { write: ['listed'], read: ['recipient'], check: 'read-once', stored: true },
  invite: { write: ['admin'], read: ['invited'], check: 'expires', stored: true },
  'key-box': { write: ['home', 'fresh'], read: ['home', 'fresh'], check: 'account-signed', stored: true },
  ...Object.fromEntries(COLLECTIONS.map((collection) => [collection, sealed])) as Record<Collection, Rule>,
  blob: { write: ['listed'], read: ['listed'], check: 'size-cap', stored: true },
  presence: { write: ['listed'], read: ['listed'], check: 'not-stored', stored: false },
} as const satisfies Record<string, Rule>

export type Kind = keyof typeof RULES
export const KINDS = Object.keys(RULES) as Kind[]
export const SEALED_KINDS = COLLECTIONS
export type SealedKind = Collection
export const TRUST_KINDS = ['member-list', 'join-request', 'letter', 'invite', 'key-box'] as const satisfies readonly Kind[]

export function isKind(value: string): value is Kind {
  return Object.hasOwn(RULES, value)
}
