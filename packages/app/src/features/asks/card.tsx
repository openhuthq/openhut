import { useState, type FormEvent } from 'react'
import * as z from 'zod/mini'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Key01Icon } from '@hugeicons/core-free-icons'
import { Face } from '@/components/agent-face'
import { AppIcon } from '@/components/app-icon'
import { connectionBrand } from '@/config/catalog'
import { RequestCard } from '@/components/request-card'
import { plainKey } from '@/lib/tool-label'
import { cn } from '@/lib/utils'
import type { AskExtra, AskKinds } from '@/lib/asks'
import { useAnswer, useAsks } from '@/lib/queries/asks'

const LONG = 1000
const HIDDEN = new Set(['id', 'connectionId', 'botToken', 'tool', 'action'])
const Field = z.object({ type: z.optional(z.string()), maxLength: z.optional(z.number()), secret: z.optional(z.boolean()), description: z.optional(z.string()) })
const Form = z.object({ properties: z._default(z.record(z.string(), Field), {}) })
type Field = z.infer<typeof Field>

export function AskCards({ agent, ids, kinds }: { agent: Agent; ids: string[]; kinds: AskKinds }) {
  const asks = useAsks(agent.id).data ?? []
  const shown = ids.flatMap((id) => asks.filter((each) => each.id === id))
  return <AskList agent={agent} asks={shown} kinds={kinds} />
}

export function PendingAsks({ agent, shown, kinds }: { agent: Agent; shown: Set<string>; kinds: AskKinds }) {
  const open = (useAsks(agent.id).data ?? []).filter((each) => each.status === 'open' && !shown.has(each.id))
  if (!open.length) return null
  return <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2 px-5 pt-3"><AskList agent={agent} asks={open} kinds={kinds} /></div>
}

function AskList({ agent, asks, kinds }: { agent: Agent; asks: Ask[]; kinds: AskKinds }) {
  const rows = asks.filter((each) => kinds.rows[each.kind])
  const done = rows.filter((each) => each.status !== 'open').length
  const all = done === rows.length
  return <>
    {rows.length > 0 && <div className={cn('flex max-w-[560px] min-w-0 flex-col rounded-xl bg-sidebar', all ? 'gap-0.5 px-4 py-2.5' : 'gap-1 p-2')} data-checklist>
      {rows.map((ask) => {
        const Row = kinds.rows[ask.kind]
        return Row && <Row key={ask.id} agent={agent} ask={ask} compact={all} />
      })}
      {!all && <p className="m-0 mt-1 border-t border-hair px-2 pt-2.5 pb-1 text-[12.5px] text-mute"><span className="text-ink">{done} of {rows.length} done</span> · {agent.name} continues when the rest are done</p>}
    </div>}
    {asks.filter((each) => !kinds.rows[each.kind]).map((ask) => {
      const Card = kinds.cards[ask.kind]
      return Card ? <Card key={ask.id} agent={agent} ask={ask} /> : <AskCard key={ask.id} agent={agent} ask={ask} extra={kinds.extras[ask.kind]} />
    })}
  </>
}

function AskCard({ agent, ask, extra: Extra }: { agent: Agent; ask: Ask; extra: AskExtra | undefined }) {
  const answer = useAnswer(agent.id)
  const [declining, setDeclining] = useState(false)
  const [editing, setEditing] = useState(false)
  const fields = Object.entries(z.safeParse(Form, ask.form ?? {}).data?.properties ?? {})
  const details = Object.entries(ask.input).filter(([key, value]) => !HIDDEN.has(key) && !fields.some(([name]) => name === key) && value !== undefined)
  const approve = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const given = Object.fromEntries(fields.flatMap(([name, field]): [string, unknown][] => {
      if (field.type === 'boolean') return [[name, form.get(name) === 'on']]
      const value = String(form.get(name) ?? '')
      return value ? [[name, value]] : []
    }))
    answer.mutate({ id: ask.id, verb: 'approvals', body: fields.length ? { answer: given } : {} })
  }
  const decline = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    answer.mutate({ id: ask.id, verb: 'declines', body: { note: String(new FormData(event.currentTarget).get('note') ?? '') } })
  }
  const formId = `ask-${ask.id}`
  const folded = fields.some(([, field]) => isLong(field))
  return <RequestCard agent={agent} change={ask} error={answer.error?.message} icon={hostsOf(ask) ? <AppIcon brand={connectionBrand({ kind: 'mcp', account: hostsOf(ask) ?? '' })} size={28} fallback={Key01Icon} /> : <Face agent={agent} size={28} />} title={ask.title}
    actions={!declining && <>
      <Button type="submit" form={formId} variant="primary" size="sm" disabled={answer.isPending}>Approve</Button>
      {folded && !editing && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      <Button type="button" variant="ghost" size="sm" disabled={answer.isPending} onClick={() => setDeclining(true)}>Not now</Button>
    </>}>
    {details.length > 0 && <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">{details.flatMap(([key, value]) => flat(key, value)).map(([key, value]) => <div key={key} className="contents">
      <dt className="text-mute">{plainKey(key)}</dt>
      <dd className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>)}</dl>}
    {Extra && <Extra agent={agent} ask={ask} />}
    {ask.status === 'open' && agent.canEdit && <form id={formId} className="flex flex-col gap-2" onSubmit={approve}>
      {fields.filter(([name]) => !folded || name in ask.input).map(([name, field]) => <div key={name} className={folded && !editing ? 'hidden' : 'contents'}><FormField name={name} field={field} value={ask.input[name]} /></div>)}
    </form>}
    {declining && <form className="flex gap-2" onSubmit={decline}>
      <Input name="note" aria-label="Why not" placeholder="Why not? (optional)" maxLength={500} autoFocus className="flex-1" />
      <Button type="submit" variant="primary" size="sm" disabled={answer.isPending}>Not now</Button>
    </form>}
  </RequestCard>
}

function FormField({ name, field, value }: { name: string; field: Field; value: unknown }) {
  const label = field.description ?? plainKey(name)
  const given = typeof value === 'string' ? value : undefined
  if (field.type === 'boolean') return <label className="flex items-center gap-2 text-[13px] text-ink"><Switch name={name} defaultChecked={value === true} aria-label={label} />{label}</label>
  if (isLong(field)) return <label className="flex flex-col gap-1 text-[12.5px] text-mute">{label}<Textarea name={name} aria-label={label} defaultValue={given} maxLength={field.maxLength} className="min-h-40" /></label>
  return <label className="flex flex-col gap-1 text-[12.5px] text-mute">{label}<Input name={name} aria-label={label} type={field.secret ? 'password' : 'text'} autoComplete="off" defaultValue={field.secret ? undefined : given} maxLength={field.maxLength} placeholder={field.secret ? `Paste the ${label.toLowerCase()}` : undefined} /></label>
}

function hostsOf(ask: Ask): string | undefined {
  const hosts = ask.input.hosts
  return Array.isArray(hosts) && typeof hosts[0] === 'string' ? hosts[0] : undefined
}

function isLong(field: Field): boolean {
  return (field.maxLength ?? 0) > LONG && !field.secret
}

function flat(key: string, value: unknown): [string, string][] {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).flatMap(([inner, each]) => flat(`${key}.${inner}`, each))
  if (typeof value === 'boolean') return [[key, value ? 'Yes' : 'No']]
  if (Array.isArray(value)) return [[key, value.length ? value.join(', ') : 'None']]
  return [[key, String(value)]]
}
