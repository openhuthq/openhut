import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ChangeRequest } from '@openhut/common/agents/change-request.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { agentPath } from '@/app/routes'
import { request } from '@/lib/api-client'
import { navigate } from '@/lib/router'

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
      request({ schema: ChangeRequest, of: agentId, path: `/api/change-requests/${encodeURIComponent(id)}/${verb}`, method: 'POST', body }),
    onSuccess: (decided) => client.setQueryData<ChangeRequest[]>(changesKey(agentId), (all) => all?.map((each) => each.id === decided.id ? decided : each)),
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
  const [mode, setMode] = useState<'view' | 'edit' | 'deny'>('view')
  const pending = change.status === 'pending'
  const editable = change.action === 'update_self'
  const send = (verb: 'approve' | 'deny', body: object) => decide.mutate({ id: change.id, verb, body }, { onSuccess: () => setMode('view') })
  const approveEdited = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = Object.fromEntries(['name', 'instructions'].filter((key) => key in change.input).map((key) => [key, String(form.get(key) ?? '')]))
    send('approve', { input })
  }
  const deny = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send('deny', { note: String(new FormData(event.currentTarget).get('note') ?? '') })
  }
  return <div className="flex max-w-[560px] min-w-0 flex-col gap-3 rounded-lg border border-hair bg-sidebar p-4">
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-ink">{change.summary}</span>
        <span className="text-[13px] text-body">{change.why}</span>
      </div>
      {change.status === 'approved' && <Badge variant="success">Approved</Badge>}
      {change.status === 'denied' && <Badge variant="secondary">Not approved</Badge>}
    </div>
    {mode === 'edit'
      ? <form className="flex flex-col gap-2" onSubmit={approveEdited}>
        {'name' in change.input && <Input name="name" aria-label="Name" defaultValue={String(change.input.name ?? '')} maxLength={40} required />}
        {'instructions' in change.input && <Textarea name="instructions" aria-label="Instructions" defaultValue={String(change.input.instructions ?? '')} maxLength={20_000} className="min-h-40" />}
        <div className="flex gap-2"><Button type="submit" variant="primary" disabled={decide.isPending}>Approve</Button><Button type="button" variant="ghost" onClick={() => setMode('view')}>Cancel</Button></div>
      </form>
      : <Details change={change} />}
    {mode === 'deny' && <form className="flex gap-2" onSubmit={deny}>
      <Input name="note" aria-label="Why not" placeholder="Why not? (optional)" maxLength={500} autoFocus className="flex-1" />
      <Button type="submit" variant="secondary" disabled={decide.isPending}>Don't approve</Button>
    </form>}
    {change.note && <span className="text-[13px] text-mute">You said: {change.note}</span>}
    {pending && mode === 'view' && (agent.canEdit
      ? <div className="flex gap-2">
        <Button type="button" variant="primary" disabled={decide.isPending} onClick={() => send('approve', {})}>Approve</Button>
        {editable && <Button type="button" variant="secondary" onClick={() => setMode('edit')}>Edit</Button>}
        <Button type="button" variant="ghost" onClick={() => setMode('deny')}>Don't approve</Button>
      </div>
      : <span className="text-[13px] text-mute">Waiting for {agent.name}'s owner.</span>)}
    {change.status === 'approved' && change.action === 'add_channel' && change.input.kind === 'whatsapp' &&
      <Button type="button" variant="secondary" className="w-fit" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'whatsapp' }))}>Scan the QR code</Button>}
    <ErrorNote message={decide.error?.message} />
  </div>
}

function Details({ change }: { change: ChangeRequest }) {
  const shown = Object.entries(change.input).filter(([key]) => key !== 'botToken' && key !== 'id' && key !== 'connectionId')
  if (!shown.length) return null
  return <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">{shown.map(([key, value]) => <div key={key} className="contents">
    <dt className="text-mute">{LABELS[key] ?? key}</dt>
    <dd className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{shownValue(value)}</dd>
  </div>)}</dl>
}

const LABELS: Record<string, string> = { name: 'Name', instructions: 'Instructions', kind: 'Channel', ownerAddress: 'Owner', open: 'Anyone can write', allowed: 'Also allowed' }

function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nobody else'
  return String(value)
}
