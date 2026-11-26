import { useState } from 'react'
import { Add01Icon, CheckmarkCircle02Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'
import { ConnectionKind, SIGN_IN_KINDS, type Connection, type Permission, type ToolGroup } from '@openhut/common/connections/connection.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Glyph } from '@/components/glyph'
import { isBrand, type BrandName } from '@/components/brand-icons'
import { I, PILL, SetupSheet } from '@/components/kit'
import { useAnswer } from '@/features/asks/api'
import type { AskRow } from '@/features/asks/custom'
import { useGrants } from '@/features/agents/api'
import { openSignInTab, useAuthorizeConnection, useConnections } from '@/features/connections/api'
import { connectionBrand, titleOf } from '@/features/connections/catalog'
import { GroupIcon, GROUPS, PermissionPicker } from '@/features/connections/permissions'
import { Field } from '@/features/connections/sheet'
import { formValues } from '@/lib/form'
import { open, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const State = z.enum(['allow', 'ask', 'deny'])
const WantedApp = z.object({
  app: ConnectionKind,
  url: z.optional(z.string()),
  name: z.optional(z.string()),
  token: z.optional(z.string()),
  guide: z.optional(z.string()),
  link: z.optional(z.string()),
  permissions: z.optional(z.partialRecord(z.enum(['read', 'create', 'update', 'delete', 'other']), State)),
})
type Wanted = z.infer<typeof WantedApp>
const SHOWN: ToolGroup[] = ['read', 'create', 'update', 'delete']
const SUGGESTED: Record<ToolGroup, Permission> = { read: 'allow', create: 'ask', update: 'ask', delete: 'deny', other: 'ask' }

const ConnectRow: AskRow = ({ agent, ask, compact }) => {
  const wanted = z.safeParse(WantedApp, ask.input).data
  const connections = useConnections().data ?? []
  const grants = useGrants({ agentId: agent.id }).data ?? []
  const opened = useOpen() === `connect:${ask.id}`
  if (!wanted) return null
  const done = ask.status === 'done'
  const granted = done ? connections.find((each) => grants.some((grant) => grant.connectionId === each.id) && matches({ connection: each, wanted })) : undefined
  const detail = granted ? granted.account.split(' · ')[0] || granted.name : detailOf(wanted)
  return <>
    <div className={cn('flex min-w-0 items-center gap-3', compact ? 'h-7' : 'min-h-11 rounded-lg px-2')} data-ask={ask.id}>
      <span className="grid size-6 shrink-0 place-items-center"><Glyph name={brandOf(wanted)} size={compact ? 16 : 20} /></span>
      <span className={cn('flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap', compact ? 'text-[13px]' : 'text-[13.5px]')}>
        <span className="shrink-0 text-ink">{nameOf(wanted)}</span>{detail && <><span className="text-mute">·</span><span className="truncate text-mute">{detail}</span></>}
      </span>
      {done && <span className={cn('inline-flex items-center gap-1.5 text-ink', compact ? 'text-[12.5px]' : 'h-7 text-[13px]')}><I icon={CheckmarkCircle02Icon} size={compact ? 14 : 16} className="animate-[pop_.45s_cubic-bezier(.2,.8,.2,1)] text-hue-green" />{!compact && 'Connected'}</span>}
      {ask.status === 'declined' && <span className="text-[13px] text-mute">Not now</span>}
      {ask.status === 'expired' && <span className="text-[13px] text-mute">Expired</span>}
      {ask.status === 'open' && (agent.canEdit
        ? <Button type="button" variant="secondary" className={PILL} onClick={() => open(`connect:${ask.id}`)}>{wanted.token ? 'Add key' : 'Connect'}</Button>
        : <span className="text-[12.5px] text-mute">Waiting for {agent.name}'s owner</span>)}
    </div>
    {opened && ask.status === 'open' && <ConnectDialog agent={agent} ask={ask} wanted={wanted} onClose={() => open()} />}
  </>
}

export const rows = { connect_app: ConnectRow }

function ConnectDialog({ agent, ask, wanted, onClose }: { agent: Agent; ask: Ask; wanted: Wanted; onClose: () => void }) {
  const answer = useAnswer(agent.id)
  const authorize = useAuthorizeConnection({ stay: true })
  const existing = (useConnections().data ?? []).filter((connection) => matches({ connection, wanted }))
  const [permissions, setPermissions] = useState<Record<ToolGroup, Permission>>({ ...SUGGESTED, ...wanted.permissions })
  const name = nameOf(wanted)
  const brand = brandOf(wanted)
  const signIn = isSignIn(wanted)
  const approve = (body: object) => answer.mutate({ id: ask.id, verb: 'approvals', body: { answer: { ...body, permissions } } }, { onSuccess: onClose })
  const decline = () => answer.mutate({ id: ask.id, verb: 'declines', body: {} }, { onSuccess: onClose })
  const sheet = { modal: true, brand, title: `Connect ${name}`, blurb: `${agent.name} asked for this`, onClose }
  if (authorize.isPending) return <SetupSheet {...sheet} foot={<Button type="button" variant="secondary" onClick={() => { authorize.reset(); onClose() }}>Cancel</Button>}>
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Spinner className="mt-0 size-5" />
      <p className="m-0 mt-2 text-[14px] font-medium text-ink">Waiting for {name} sign-in…</p>
      <p className="m-0 text-[13px] text-mute">We opened it in a new tab. Come back here when you’re done.</p>
      {authorize.url && <p className="m-0 mt-3 text-[12.5px] text-mute">Didn’t open? <a href={authorize.url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">Open again</a></p>}
    </div>
  </SetupSheet>
  const connect = (fields: Record<string, string>) => {
    if (!signIn) return approve({ fields })
    authorize.mutate({ kind: wanted.app === 'mcp' ? 'mcp' : signInKind(wanted.app), name, url: wanted.url, askId: ask.id, permissions, tab: openSignInTab() }, { onSuccess: (done) => { if (done) onClose() } })
  }
  return <SetupSheet {...sheet} error={answer.error?.message ?? authorize.error?.message} safe={`${agent.name} gets access as soon as you connect.`}
    onSubmit={(event) => connect(fieldsOf({ wanted, field: formValues(event) }))}
    foot={<><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={answer.isPending}>Connect</Button></>}>
    <div className="flex flex-col gap-1.5">
      {existing.map((connection) => <div key={connection.id} className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 shadow-[inset_0_0_0_1px_var(--hair)]">
        <Glyph name={connectionBrand(connection)} size={20} />
        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[13px] text-ink">Use existing: {connection.name}</span><span className="truncate text-[12px] text-mute">{connection.account || `Connected by ${connection.ownerName}`} · {connection.agents === 1 ? '1 agent uses it' : `${connection.agents} agents use it`}</span></span>
        <Button type="button" variant="secondary" className={PILL} disabled={answer.isPending} onClick={() => approve({ connectionId: connection.id })}>Use this</Button>
      </div>)}
      {signIn ? <div className="flex min-h-12 items-center gap-3 rounded-lg bg-tint px-3 py-2 shadow-[inset_0_0_0_1.5px_var(--ink)]">
        <span className="grid size-5 place-items-center text-ink"><I icon={Add01Icon} size={16} /></span>
        <span className="flex min-w-0 flex-1 flex-col"><span className="text-[13px] text-ink">{existing.length ? `Sign in to another ${name} account` : `Sign in to ${name}`}</span><span className="text-[12px] text-mute">Opens {name} in a new tab</span></span>
        <I icon={LinkSquare02Icon} size={14} className="text-mute" />
      </div> : <KeyFields wanted={wanted} />}
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-[12px]/[16px] text-mute">{agent.name} will be able to:</span>
      {SHOWN.map((group) => <div key={group} className="flex h-9 items-center gap-2.5">
        <GroupIcon group={group} />
        <span className="flex-1 text-[13px] text-ink">{GROUPS[group].label}</span>
        <PermissionPicker value={permissions[group]} label={GROUPS[group].label} onPick={(permission) => setPermissions({ ...permissions, [group]: permission })} />
      </div>)}
    </div>
    <p className="m-0 text-[12.5px] text-mute">Not now? <Button type="button" variant="link" className="h-auto p-0 text-[12.5px] text-ink" disabled={answer.isPending} onClick={decline}>Tell {agent.name} to do without it</Button></p>
  </SetupSheet>
}

function KeyFields({ wanted }: { wanted: Wanted }) {
  if (wanted.app === 'postgres') return <Field label="Connection string"><Input mono name="dsn" type="password" required autoComplete="off" placeholder="postgres://reader:…@host:5432/db" /></Field>
  if (wanted.app === 'convex') return <Field label="Deploy key"><Input mono name="deployKey" type="password" required autoComplete="off" /></Field>
  if (wanted.app !== 'mcp') return null
  return <div className="flex flex-col gap-2">
    {wanted.guide && <p className="m-0 text-[13px]/[19px] text-body">{wanted.guide}</p>}
    <Field label={wanted.token ?? 'Token'}><Input mono name="token" type="password" required autoComplete="off" placeholder={`Paste your ${wanted.token ?? 'token'}`} /></Field>
    {wanted.link && <a href={wanted.link} target="_blank" rel="noreferrer" className="w-fit text-[12.5px] text-ink underline underline-offset-2">Make one in {nameOf(wanted)} ↗</a>}
  </div>
}

function fieldsOf({ wanted, field }: { wanted: Wanted; field: (name: string) => string }): Record<string, string> {
  if (wanted.app === 'postgres') return { dsn: field('dsn') }
  if (wanted.app === 'convex') return { deployKey: field('deployKey') }
  if (wanted.app === 'mcp') return { token: field('token') }
  return {}
}

function isSignIn(wanted: Wanted): boolean {
  if (wanted.app === 'mcp') return !wanted.token
  return SIGN_IN_KINDS.some((kind) => kind === wanted.app)
}

function signInKind(app: Wanted['app']) {
  return SIGN_IN_KINDS.find((kind) => kind === app)
}

function hostOf(url: string | undefined): string | undefined {
  return url && URL.canParse(url) ? new URL(url).host : undefined
}

function matches({ connection, wanted }: { connection: Connection; wanted: Wanted }): boolean {
  return connection.kind === wanted.app && (wanted.app !== 'mcp' || connection.account.split(' · ')[0] === hostOf(wanted.url))
}

function nameOf(wanted: Wanted): string {
  return wanted.name ?? titleOf(wanted.app)
}

function brandOf(wanted: Wanted): BrandName {
  const brand = connectionBrand({ kind: wanted.app, account: hostOf(wanted.url) ?? '', name: wanted.name })
  return isBrand(brand) ? brand : 'mcp'
}

function detailOf(wanted: Wanted): string {
  if (wanted.token) return 'token'
  if (wanted.app === 'postgres') return wanted.permissions?.create === 'allow' || wanted.permissions?.update === 'allow' ? '' : 'read only'
  return hostOf(wanted.url) ?? ''
}
