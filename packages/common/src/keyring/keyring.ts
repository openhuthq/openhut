import type { MemberList, MemberListBody } from '../cloud/cloud.ts'
import type { SealedKind } from '../cloud/rules.ts'
import type { PostMemberList } from '../cloud/v1/trust.ts'
import type { Opened, Value } from '../records/row.ts'
import type { PutSealed, SealedRow } from '../records/wire.ts'

export type Change = PostMemberList
export type Kit = { words: string[]; kitId: string }

export type Keyring = {
  seal: (input: { team: string; kind: SealedKind; id: string; parent: string | null; ver: number; value: Value | null }) => Promise<PutSealed>
  open: (row: SealedRow) => Promise<Opened | null>
  approve: (input: { team: string; device: string; faces?: number[] }) => Promise<Change>
  remove: (input: { team: string; device: string; lost?: boolean }) => Promise<Change>
  rotate: (team: string) => Promise<Change>
  kit: () => Promise<Kit>
  restore: (input: { words: string[] } | { passkey: Uint8Array }) => Promise<void>
  verifyList: (input: { team: string; chain: MemberList[] }) => Promise<MemberListBody | null>
}
