import * as z from 'zod/mini'
import { parseJson, type Member } from '@openhut/common/cloud/cloud.ts'
import type { AgentValue, Opened, Synced } from '@openhut/common/cloud/record.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { fromBase64, letter, read, toBase64, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { agentService } from '../agents/agent-service.ts'
import { memoryService } from '../agents/memory-service.ts'
import { connectionService } from '../connections/connection-service.ts'
import { setUsageData } from '../platform/events.ts'
import { settings } from '../platform/settings.ts'
import { routineService } from '../routines/routine-service.ts'
import { threadService } from '../threads/thread-service.ts'
import { applyFile, fileLocals, type Owned } from './sync-files.ts'

export type Local = { kind: Synced; ref: string; value: unknown; wire?: () => Promise<unknown>; owner?: string; agentId?: string; assistant?: boolean }
export type Context = {
  workspace: string; home: boolean; key: Bytes; version: number; keys: Record<number, Bytes>; slotKey: Bytes; me: Identity; members: Member[]; runtimes: string[]; own: Bytes | null; email: string; admin: boolean
  putFile: (input: { hash: string; body: Bytes }) => Promise<number>; getFile: (hash: string) => Promise<Bytes | null>; again: () => void
  landed: (input: { kind: Synced; ref: string; value: unknown; owner: string | undefined }) => void
}
export type Row = { signer: string | null; agent_id: string | null }

const Config = z.record(z.string(), z.unknown())
const text = new TextEncoder()
const words = new TextDecoder()

export const syncKinds = {
  async locals({ kind, ctx }: { kind: Synced; ctx: Context }): Promise<Local[] | null> {
    const me = toBase64(ctx.me.publicKey)
    const agents = await agentService.synced({ workspace: ctx.home ? null : ctx.workspace, owner: ctx.email })
    const owned: Owned = new Map(agents.map((agent) => [agent.id, agent.shared ? undefined : agent.owner]))
    switch (kind) {
      case 'agent': return agents.map((value) => ({ kind, ref: value.id, value, owner: owned.get(value.id) }))
      case 'setting': return ctx.admin && ctx.home ? settingLocals() : null
      case 'connection': return ctx.admin && ctx.home ? connectionLocals(ctx) : null
      case 'message': return (await threadService.synced()).filter((value) => owned.has(value.agentId)).map((value) => ({ kind, ref: value.message.id, value, owner: owned.get(value.agentId), agentId: value.agentId, assistant: value.message.role === 'assistant' }))
      case 'memory': {
        const here = agents.filter((agent) => agent.runsOn === me).map((agent) => agent.id)
        return (await memoryService.synced({ agentIds: here })).map((value) => ({ kind, ref: value.agentId, value, owner: owned.get(value.agentId), agentId: value.agentId }))
      }
      case 'file': return fileLocals({ ctx, owned })
      case 'head': return null
    }
  },

  async hide({ open, ctx }: { open: Opened; ctx: Context }): Promise<undefined> {
    if (open.kind === 'agent' && open.owner && open.owner !== ctx.email) await agentService.hideSynced({ id: open.ref, owner: open.owner, workspace: workspaceOf(ctx), me: ctx.email })
    return undefined
  },

  async allowed({ open, ctx, row }: { open: Opened; ctx: Context; row: Row | undefined }): Promise<boolean> {
    const runner = async (id: string) => (await agentService.placement({ id }))?.runsOn
    switch (open.kind) {
      case 'agent': return !open.value || agentAllowed({ value: open.value, by: open.by, ctx, row })
      case 'memory': return await runner(open.value?.agentId ?? open.ref) === open.by
      case 'message': {
        const runsOn = await runner(open.value?.agentId ?? row?.agent_id ?? '')
        if (open.value?.message.role === 'assistant') return runsOn === open.by
        return !row?.signer || row.signer === open.by || (!open.value && runsOn === open.by)
      }
      case 'file': return !row?.signer || row.signer === open.by || await runner(open.value?.agentId ?? row.agent_id ?? '') === open.by
      default: return true
    }
  },

  async apply({ open, ctx, later }: { open: Opened; ctx: Context; later: (ref: string) => boolean }): Promise<unknown> {
    const author = ctx.members.find((member) => member.devices.includes(open.by))
    if (!author) return undefined
    const agentId = await agentOf(open)
    if (agentId && !await agentService.writableBy({ id: agentId, author, workspace: workspaceOf(ctx), me: ctx.email })) return undefined
    const mine = author.email === ctx.email
    const by = author.email
    switch (open.kind) {
      case 'agent': {
        const devices = [toBase64(ctx.me.publicKey), ...ctx.members.find((member) => member.email === ctx.email)?.devices ?? []]
        return agentService.applySynced({ id: open.ref, value: open.value, author: { ...author, device: open.by }, workspace: workspaceOf(ctx), me: ctx.email, mine: devices })
      }
      case 'setting': return open.value && ctx.home && mine ? applySetting(open.value) : undefined
      case 'message': return threadService.applySynced({ id: open.ref, value: open.value, author: by, later })
      case 'memory': return open.value && memoryService.applySynced(open.value)
      case 'file': return open.value ? applyFile({ value: open.value, ctx, owner: open.owner }) : undefined
      case 'head': return undefined
      case 'connection': {
        if (!ctx.home || !mine) return undefined
        const value = open.value
        if (!value) return connectionService.applySynced({ id: open.ref, value: null, by })
        const sealed = value.keys.find((each) => each.to === toBase64(ctx.me.publicKey))
        const plain = sealed && await read({ recipient: ctx.me, from: fromBase64(open.by), workspace: ctx.workspace, purpose: 'connection-key', body: fromBase64(sealed.body), allowed: ctx.runtimes.map(fromBase64) })
        const config = plain ? Config.safeParse(parseJson(words.decode(plain))).data ?? null : null
        return connectionService.applySynced({ id: value.id, value: { id: value.id, kind: value.kind, name: value.name, account: value.account, signIn: value.signIn, config }, by })
      }
    }
  },
}

function workspaceOf(ctx: Context): string | null {
  return ctx.home ? null : ctx.workspace
}

async function agentOf(open: Opened): Promise<string | undefined> {
  if (open.kind === 'message') return threadService.agentOfMessage({ id: open.ref, value: open.value })
  if (open.kind === 'memory' || open.kind === 'file') return open.value?.agentId
  return undefined
}

async function agentAllowed({ value, by, ctx, row }: { value: AgentValue; by: string; ctx: Context; row: Row | undefined }): Promise<boolean> {
  const author = ctx.members.find((each) => each.devices.includes(by))
  const current = await agentService.placement({ id: value.id })
  const first = row?.signer
  const before = first ? ctx.members.find((each) => each.devices.includes(first)) : undefined
  if (!current && before && before.email !== author?.email) return false
  const limited = author?.role === 'member' && (current?.owner ?? (current ? ctx.email : author.email)) !== author.email
  const listed = ctx.members.some((each) => value.runsOn !== undefined && each.devices.includes(value.runsOn))
  if (value.runsOn !== current?.runsOn && (!listed || limited)) return false
  return !limited || value.codeExecution === (current?.codeExecution ?? false)
}

function settingLocals(): Local[] {
  const kind = 'setting'
  return [
    { kind, ref: 'time_zone', value: { name: 'time_zone', value: settings.timeZone() } },
    { kind, ref: 'usage_data', value: { name: 'usage_data', value: settings.usageData() } },
    { kind, ref: 'models', value: { name: 'models', value: PROVIDERS.flatMap(({ id }) => { const catalog = settings.catalog(id); return catalog ? [{ provider: id, ...catalog }] : [] }) } },
  ]
}

async function applySetting(setting: Extract<Opened, { kind: 'setting' }>['value'] & object): Promise<void> {
  if (setting.name === 'time_zone') return routineService.setTimeZone(setting.value)
  if (setting.name === 'usage_data') {
    await settings.setUsageData(setting.value)
    return setUsageData(setting.value)
  }
  for (const { provider, at, models } of setting.value) await settings.setCatalog(provider, { at, models })
}

async function connectionLocals(ctx: Context): Promise<Local[]> {
  const to = [...ctx.runtimes].sort()
  return (await connectionService.synced()).flatMap(({ config, ...plain }) => config ? [{
    kind: 'connection' as const, ref: plain.id, value: { ...plain, config, to },
    wire: async () => ({ ...plain, keys: await Promise.all(to.map(async (device) => ({ to: device, body: toBase64(await letter({ sender: ctx.me, to: fromBase64(device), workspace: ctx.workspace, purpose: 'connection-key', version: ctx.version, plain: text.encode(JSON.stringify(config)) }) ?? new Uint8Array()) }))) }),
  }] : [])
}
