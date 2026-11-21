import * as z from 'zod/mini'
import { Wanted } from '../agents/agent.ts'
import { ConnectionKind } from '../connections/connection.ts'
import { ModelKey, ProviderId, ProviderModel } from '../models/provider.ts'
import { ChatMessage, fileInHome, AGENT_HOME } from '../threads/thread.ts'
import { checkRecord, DeviceKey, Locked, Member, parseJson, recordBind, Signed, signRecord, type Record as CloudRecord } from './cloud.ts'
import { fromBase64, lock, newKey, readHeader, toBase64, unlock, type Bytes, type Identity } from '../vault/vault.ts'

const AgentId = z.string().check(z.regex(/^ag_[a-z0-9]{8}$/))
const Hash = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/))
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const Face = z.string().check(z.maxLength(60_000), z.refine((face) => PICTURE.test(face) || face.startsWith('{'), 'A face is a look or a PNG, JPEG or WebP picture.'))
const MemoryText = z.nullable(z.string().check(z.maxLength(10_000)))

export const AgentValue = z.object({
  id: AgentId,
  name: z.string().check(z.minLength(1), z.maxLength(40)),
  instructions: z.string().check(z.maxLength(20_000)),
  model: ModelKey,
  face: z.nullable(Face),
  codeExecution: z.boolean(),
  wanted: Wanted,
  runsOn: z.optional(DeviceKey),
  shared: z.optional(z.boolean()),
  owner: z.optional(Member.shape.email),
})
export type AgentValue = z.infer<typeof AgentValue>

export const SettingValue = z.discriminatedUnion('name', [
  z.object({ name: z.literal('time_zone'), value: z.string().check(z.maxLength(64)) }),
  z.object({ name: z.literal('usage_data'), value: z.boolean() }),
  z.object({ name: z.literal('models'), value: z.array(z.object({ provider: ProviderId, at: z.string().check(z.maxLength(40)), models: z.array(ProviderModel).check(z.maxLength(2000)) })).check(z.maxLength(10)) }),
])
export type SettingValue = z.infer<typeof SettingValue>

export const ConnectionValue = z.object({
  id: z.string().check(z.regex(/^cn_[a-z0-9]{8}$/)),
  kind: ConnectionKind,
  name: z.string().check(z.maxLength(100)),
  account: z.string().check(z.maxLength(200)),
  signIn: z.boolean(),
  keys: z.array(z.object({ to: DeviceKey, body: Locked })).check(z.maxLength(50)),
})
export type ConnectionValue = z.infer<typeof ConnectionValue>

export const HeadValue = z.object({
  records: z.array(z.tuple([z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/)), z.number().check(z.int(), z.minimum(1))])).check(z.maxLength(50_000)),
})
export type HeadValue = z.infer<typeof HeadValue>

export const MessageValue = z.object({ agentId: AgentId, message: ChatMessage })
export type MessageValue = z.infer<typeof MessageValue>

export const MemoryValue = z.object({ agentId: AgentId, notes: MemoryText, people: MemoryText })
export type MemoryValue = z.infer<typeof MemoryValue>

export const FileValue = z.object({
  agentId: AgentId,
  path: z.string().check(z.refine((path) => fileInHome(`${AGENT_HOME}/${path}`) === path, 'Send a path inside the agent\'s home.')),
  size: z.number().check(z.int(), z.minimum(0), z.maximum(32 << 20)),
  sha: Hash,
  chunks: z.array(Hash).check(z.maxLength(32)),
})
export type FileValue = z.infer<typeof FileValue>

export const SYNCED = ['agent', 'setting', 'connection', 'message', 'memory', 'file', 'head'] as const
export type Synced = (typeof SYNCED)[number]
export type Own = { key: Bytes; email: string }
export type Opened = ({ kind: 'agent'; ref: string; value: AgentValue | null; by: string }
  | { kind: 'setting'; ref: string; value: SettingValue | null; by: string }
  | { kind: 'connection'; ref: string; value: ConnectionValue | null; by: string }
  | { kind: 'message'; ref: string; value: MessageValue | null; by: string }
  | { kind: 'memory'; ref: string; value: MemoryValue | null; by: string }
  | { kind: 'file'; ref: string; value: FileValue | null; by: string }
  | { kind: 'head'; ref: string; value: HeadValue | null; by: string }) & { owner?: string; hidden?: true }
export type Sealed = { ver: number; deleted: boolean; body: string }

const ADMIN_ONLY: Synced[] = ['setting', 'connection']
const VALUES = { agent: AgentValue, setting: SettingValue, connection: ConnectionValue, message: MessageValue, memory: MemoryValue, file: FileValue, head: HeadValue }
const Body = z.object({
  change: z.string().check(z.length(16)),
  kind: z.enum(SYNCED),
  counter: z.number().check(z.int(), z.minimum(1)),
  ref: z.string().check(z.minLength(1), z.maxLength(1100)),
  value: z.unknown(),
})
const Hidden = z.object({ hidden: Locked, owner: Member.shape.email })
const text = new TextEncoder()
const words = new TextDecoder()

export function refOf(opened: Opened): string | null {
  if (!opened.value) return null
  switch (opened.kind) {
    case 'head': return 'head'
    case 'setting': return opened.value.name
    case 'message': return opened.value.message.id
    case 'memory': return opened.value.agentId
    case 'file': return `${opened.value.agentId}/${opened.value.path}`
    default: return opened.value.id
  }
}

export async function sealRecord({ workspace, key, version, signer, id, ver, kind, ref, value, own }: {
  workspace: string; key: Bytes; version: number; signer: Identity; id: string; ver: number; kind: Synced; ref: string; value: unknown; own?: Own
}): Promise<Sealed | null> {
  const parsed = value === null ? null : VALUES[kind].safeParse(value).data
  if (parsed === undefined || (parsed !== null && refOf({ kind, ref, value: parsed, by: '' } as Opened) !== ref)) return null
  const inner = own && value !== null ? await lock({ key: own.key, version, bind: ownBind({ workspace, id, owner: own.email }), plain: text.encode(JSON.stringify(value)) }) : null
  if (own && value !== null && !inner) return null
  const wire = own && inner ? { hidden: toBase64(inner), owner: own.email } : value
  const bytes = text.encode(JSON.stringify({ change: toBase64(newKey(12)), kind, counter: ver, ref, value: wire }))
  const signed = await signRecord({ signer, bind: recordBind({ workspace, id, kind }), bytes })
  const locked = await lock({ key, version, bind: lockBind({ workspace, id }), plain: text.encode(JSON.stringify(signed)) })
  return locked && { ver, deleted: value === null, body: toBase64(locked) }
}

export async function openRecord({ workspace, keys, record, members, own }: { workspace: string; keys: Record<number, Bytes>; record: CloudRecord; members: Member[]; own?: Own | null }): Promise<Opened | null> {
  const plain = await unlock({ keys, bind: lockBind({ workspace, id: record.id }), locked: fromBase64(record.body) })
  const signed = plain && Signed.safeParse(parseJson(words.decode(plain))).data
  const author = signed && members.find((member) => member.devices.includes(signed.by))
  if (!signed || !author) return null
  const head = Body.safeParse(parseJson(words.decode(fromBase64(signed.bytes)))).data
  if (!head || (ADMIN_ONLY.includes(head.kind) && author.role === 'member')) return null
  const bytes = await checkRecord({ signed, bind: recordBind({ workspace, id: record.id, kind: head.kind }) })
  const hidden = Hidden.safeParse(head.value).data
  if (!bytes || head.counter !== record.ver || (hidden && (hidden.owner !== author.email || record.deleted))) return null
  const inner = hidden && own?.email === hidden.owner ? await openOwn({ workspace, id: record.id, own, hidden }) : undefined
  if (hidden && inner === undefined) return { kind: head.kind, ref: head.ref, value: null, by: signed.by, owner: hidden.owner, hidden: true } as Opened
  const raw = hidden ? inner : head.value
  const value = raw === null ? null : VALUES[head.kind].safeParse(raw).data
  const opened = { kind: head.kind, ref: head.ref, value: value ?? null, by: signed.by, ...hidden && { owner: hidden.owner } } as Opened
  const fits = value !== undefined && record.deleted === (value === null) && (value === null || refOf(opened) === head.ref)
  return fits ? opened : null
}

async function openOwn({ workspace, id, own, hidden }: { workspace: string; id: string; own: Own; hidden: z.infer<typeof Hidden> }): Promise<unknown> {
  const locked = fromBase64(hidden.hidden)
  const version = readHeader(locked)?.version ?? 0
  const plain = await unlock({ keys: { [version]: own.key }, bind: ownBind({ workspace, id, owner: hidden.owner }), locked })
  return plain ? parseJson(words.decode(plain)) ?? undefined : undefined
}

function ownBind({ workspace, id, owner }: { workspace: string; id: string; owner: string }): string {
  return `workspace/${workspace}/own/${owner}/record/${id}`
}

function lockBind({ workspace, id }: { workspace: string; id: string }): string {
  return `workspace/${workspace}/record/${id}`
}
