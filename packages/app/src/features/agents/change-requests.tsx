import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChangeRequest } from '@openhut/common/agents/change-request.ts'
import { AlertCircleIcon, PencilEdit02Icon, SecurityCheckIcon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Glyph } from '@/components/glyph'
import { isBrand } from '@/components/brand-icons'
import { Face } from '@/features/agents/face'
import { DetailRow, Details as DetailsToggle, RequestCard, EXPIRED } from '@/features/agents/request-card'
import { useConnections } from '@/features/connections/api'
import { connectionBrand } from '@/features/connections/catalog'
import { agentPath } from '@/app/routes'
import { request } from '@/lib/api-client'
import { CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { ProposedConnectionCard } from '@/features/connections/proposed-connection'
import { SecretCard } from '@/features/agents/secrets'

import { navigate } from '@/lib/router'
import { plainKey, toolLabel } from '@/lib/tool-label'
import * as z from 'zod/mini'

const REQUEST_LIST = List(ChangeRequest)

const changesKey = (agentId: string) => ['change-requests', agentId]

function useChangeRequests(agentId: string) {
  return useQuery({
    queryKey: changesKey(agentId),
    queryFn: () => request({ schema: REQUEST_LIST, of: agentId, path: `/api/change-requests?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}

function useDecide(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, verb, body }: { id: string; verb: 'approve' | 'deny'; body: object }) =>
      request({ schema: ChangeRequest, of: agentId, path: `/api/change-requests/${encodeURIComponent(id)}/${verb === 'approve' ? 'approvals' : 'denials'}`, method: 'POST', body }),
    onSuccess: (decided) => {
      client.setQueryData<ChangeRequest[]>(changesKey(agentId), (all) => all?.map((each) => each.id === decided.id ? decided : each))
      if (decided.action === 'call_tool') void client.invalidateQueries({ queryKey: ['agent-tools', agentId] })
      if (decided.action === 'propose_connection') void Promise.all([CONNECTIONS_KEY, GRANTS_KEY].map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })
}

export function ChangeCards({ agent, ids }: { agent: Agent; ids: string[] }) {
  const requests = useChangeRequests(agent.id).data
  return <>{ids.map((id) => {
    const found = requests?.find((each) => each.id === id)
    return found && <ChangeCard key={id} agent={agent} change={found} />
  })}</>
}

export function PendingElsewhere({ agent, shown }: { agent: Agent; shown: Set<string> }) {
  const pending = useChangeRequests(agent.id).data?.filter((each) => each.status === 'pending' && !shown.has(each.id)) ?? []
  if (!pending.length) return null
  return <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2 px-5 pt-3">{pending.map((change) => <ChangeCard key={change.id} agent={agent} change={change} />)}</div>
}

function ChangeCard({ agent, change }: { agent: Agent; change: ChangeRequest }) {
  const decide = useDecide(agent.id)
  const props = { agent, change, busy: decide.isPending, error: decide.error?.message, send: (verb: 'approve' | 'deny', body: object) => decide.mutate({ id: change.id, verb, body }) }
  if (change.action === 'call_tool') return <ToolCallCard {...props} />
  if (change.action === 'propose_connection') return <ProposedConnectionCard {...props} />
  if (change.action === 'add_secret') return <SecretCard {...props} />
  return <SettingsCard {...props} />
}

export type CardProps = { agent: Agent; change: ChangeRequest; busy: boolean; error: string | undefined; send: (verb: 'approve' | 'deny', body: object) => void }

function SettingsCard({ agent, change, busy, error, send }: CardProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'deny'>('view')
  const editable = change.action === 'update_self'
  const kind = typeof change.input.kind === 'string' && isBrand(change.input.kind) ? change.input.kind : undefined
  const approveEdited = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = Object.fromEntries(['name', 'instructions'].filter((key) => key in change.input).map((key) => [key, String(form.get(key) ?? '')]))
    send('approve', { input })
    setMode('view')
  }
  const deny = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send('deny', { note: String(new FormData(event.currentTarget).get('note') ?? '') })
    setMode('view')
  }
  return <RequestCard agent={agent} change={change} error={error} icon={kind ? <Glyph name={kind} size={22} /> : <Face agent={agent} size={28} />} action={{ icon: PencilEdit02Icon, hue: 'text-hue-violet' }} title={change.summary}
    actions={mode === 'view' && <>
      <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => send('approve', {})}>Approve</Button>
      {editable && <Button type="button" variant="ghost" size="sm" onClick={() => setMode('edit')}>Edit</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={() => setMode('deny')}>Don't approve</Button>
    </>}>
    {mode === 'edit'
      ? <form className="flex flex-col gap-2" onSubmit={approveEdited}>
        {'name' in change.input && <Input name="name" aria-label="Name" defaultValue={String(change.input.name ?? '')} maxLength={40} required />}
        {'instructions' in change.input && <Textarea name="instructions" aria-label="Instructions" defaultValue={String(change.input.instructions ?? '')} maxLength={20_000} className="min-h-40" />}
        <div className="flex gap-2"><Button type="submit" variant="primary" size="sm" disabled={busy}>Approve</Button><Button type="button" variant="ghost" size="sm" onClick={() => setMode('view')}>Cancel</Button></div>
      </form>
      : <Details agent={agent} change={change} />}
    {mode === 'deny' && <form className="flex gap-2" onSubmit={deny}>
      <Input name="note" aria-label="Why not" placeholder="Why not? (optional)" maxLength={500} autoFocus className="flex-1" />
      <Button type="submit" variant="primary" size="sm" disabled={busy}>Don't approve</Button>
    </form>}
    {change.status === 'approved' && change.action === 'add_channel' && change.input.kind === 'whatsapp' &&
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'whatsapp' }))}>Scan the QR code</Button>}
  </RequestCard>
}

function Details({ agent, change }: { agent: Agent; change: ChangeRequest }) {
  const shown = Object.entries(change.input).filter(([key]) => key !== 'botToken' && key !== 'id' && key !== 'connectionId')
  if (!shown.length) return null
  return <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">{shown.map(([key, value]) => <div key={key} className="contents">
    <dt className="text-mute">{LABELS[key] ?? key}</dt>
    <dd className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{key === 'instructions' && change.status === 'pending' ? <LineDiff before={agent.instructions} after={String(value)} /> : shownValue(value)}</dd>
  </div>)}</dl>
}

function LineDiff({ before, after }: { before: string; after: string }) {
  const old = before.split('\n').filter((line) => line.trim())
  const next = after.split('\n')
  const gone = old.filter((line) => !next.includes(line))
  return <span className="flex flex-col text-[13px]/[1.6]">
    {gone.map((line, index) => <span key={`-${index}`} className="text-mute line-through">{line}</span>)}
    {next.map((line, index) => !old.includes(line) && line.trim() ? <span key={index} className="text-ink"><span className="text-hue-green">+ </span>{line}</span> : <span key={index} className="text-body">{line || ' '}</span>)}
  </span>
}

const ToolInput = z.object({ connectionId: z.string(), tool: z.string(), arguments: z.record(z.string(), z.unknown()), always: z.optional(z.boolean()) })
const RISKY = /delete|remove|destroy|drop|purge|wipe/i

function ToolCallCard({ agent, change, busy, error, send }: CardProps) {
  const input = z.safeParse(ToolInput, change.input).data
  const connection = useConnections().data?.find((each) => each.id === input?.connectionId)
  if (!input) return null
  const decided = { approved: { label: input.always ? `Saved: ${agent.name} can always do this` : 'Allowed once', tone: 'success' as const }, denied: { label: 'Not allowed', tone: 'secondary' as const }, pending: undefined, expired: EXPIRED }[change.status]
  const args = flat(input.arguments)
  return <RequestCard agent={agent} change={change} error={error} decided={decided} icon={connection ? <Glyph name={connectionBrand(connection)} size={22} /> : <Face agent={agent} size={28} />} action={{ icon: SecurityCheckIcon, hue: 'text-hue-amber' }}
    title={<>{agent.name} wants to {toolLabel(input.tool, 'now')}{connection && <> in {connection.name}</>}.</>}
    actions={<>
      <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => send('approve', {})}>Allow once</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => send('approve', { always: true })}>Always allow</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => send('deny', {})}>Don't allow</Button>
    </>}>
    {RISKY.test(input.tool) && <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><I icon={AlertCircleIcon} size={14} className="text-hue-red" />This can't be undone.</span>}
    <DetailsToggle>
      {args.map(([key, value]) => <DetailRow key={key} label={plainKey(key)}>{value}</DetailRow>)}
      <DetailRow label="Tool"><code className="font-mono text-[12px]">{input.tool}</code></DetailRow>
    </DetailsToggle>
  </RequestCard>
}

function flat(value: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, each]): [string, string][] => each && typeof each === 'object' && !Array.isArray(each) ? flat(each as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, String(each)]])
}

const LABELS: Record<string, string> = { name: 'Name', instructions: 'Instructions', kind: 'Channel', ownerAddress: 'Owner', open: 'Anyone can write', allowed: 'Also allowed' }

function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nobody else'
  return String(value)
}
