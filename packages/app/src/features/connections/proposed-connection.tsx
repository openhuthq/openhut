import { useState } from 'react'
import { Cancel01Icon, PlugSocketIcon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { brandOf } from '@openhut/common/asks/ask.ts'
import { ProposedConnection, type Permission, type ToolGroup } from '@openhut/common/connections/connection.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { isBrand, type BrandName } from '@/components/brand-icons'
import { DialogCard, I } from '@/components/kit'
import type { CardProps } from '@/features/agents/change-requests'
import { DetailRow, Details, EXPIRED, RequestCard } from '@/features/agents/request-card'
import { GroupIcon, PermissionPicker } from '@/features/connections/permissions'
import { Field } from '@/features/connections/sheet'
import { formValues } from '@/lib/form'

const SHOWN = 3
export const BROWSER = 'Do it once with the browser'
export const MYSELF = 'I’ll set it up myself'

export function ProposedConnectionCard({ agent, change, busy, error, send }: CardProps) {
  const proposal = z.safeParse(ProposedConnection, change.input).data
  const [groups, setGroups] = useState(proposal?.groups ?? [])
  const [connecting, setConnecting] = useState(false)
  const [all, setAll] = useState(false)
  if (!proposal) return null
  const brand = brandOf({ app: 'mcp', url: proposal.url })
  const glyph: BrandName = isBrand(brand) ? brand : 'mcp'
  const editable = change.status === 'open' && agent.canEdit
  const move = ({ group, permission }: { group: ToolGroup; permission: Permission }) => setGroups(groups.map((each) => each.group === group ? { ...each, permission } : each))
  const shown = all ? groups : groups.slice(0, SHOWN)
  const decided = { done: { label: `${proposal.name} is connected`, tone: 'success' as const }, declined: { label: 'Not connected', tone: 'secondary' as const }, open: undefined, expired: EXPIRED }[change.status]
  return <RequestCard agent={agent} change={change} error={connecting ? undefined : error} decided={decided} icon={<Glyph name={glyph} size={22} />} action={{ icon: PlugSocketIcon, hue: 'text-hue-blue' }}
    title={<>{agent.name} wants to connect {proposal.name}{proposal.line && `, ${proposal.line}`}.</>}
    actions={<>
      <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => setConnecting(true)}>Connect {proposal.name}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => send('deny', { note: BROWSER })}>{BROWSER}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => send('deny', { note: MYSELF })}>{MYSELF}</Button>
    </>}>
    <div className="flex flex-col">
      {shown.map((group) => <div key={group.group} className="flex min-h-9 min-w-0 items-center gap-3">
        <GroupIcon group={group.group} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{group.label}</span>
        <PermissionPicker value={group.permission} label={group.label} disabled={!editable} onPick={(permission) => move({ group: group.group, permission })} />
      </div>)}
      {groups.length > SHOWN && <Button type="button" variant="text" className="mt-1 w-fit text-[12.5px] text-mute" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${groups.length}`}</Button>}
    </div>
    <Details>
      <DetailRow label="Server">{proposal.url}</DetailRow>
      {proposal.token.scopes?.length ? <DetailRow label="Token needs">{proposal.token.scopes.join(', ')}</DetailRow> : null}
    </Details>
    {connecting && <ConnectDialog agent={agent} proposal={proposal} glyph={glyph} busy={busy} error={error} onClose={() => setConnecting(false)} onConnect={(token) => send('approve', { answer: { groups, key: token } })} />}
  </RequestCard>
}

function ConnectDialog({ agent, proposal, glyph, busy, error, onClose, onConnect }: { agent: Agent; proposal: ProposedConnection; glyph: BrandName; busy: boolean; error: string | undefined; onClose: () => void; onConnect: (token: string) => void }) {
  return <DialogCard onClose={onClose} className="w-[460px] gap-0 overflow-hidden p-0">
    <form className="contents" onSubmit={(event) => onConnect(formValues(event)('token').trim())}>
      <div className="flex items-center gap-3 px-6 pt-6 pb-5">
        <Glyph name={glyph} size={28} />
        <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">Connect {proposal.name}</DialogTitle>
        <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mt-1 -mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
      </div>
      <div className="flex flex-col gap-3 px-6 pb-2">
        <p className="m-0 text-[13px]/[19px] text-body">{proposal.token.guide}</p>
        <Field label={proposal.token.label}><Input name="token" type="text" required autoFocus autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false} className="[-webkit-text-security:disc]" placeholder={`Paste your ${proposal.token.label}`} /></Field>
        <p className="m-0 text-[12.5px]/[18px] text-mute"><a href={proposal.token.link} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">Make one in {proposal.name} ↗</a> · {agent.name} never sees it.</p>
      </div>
      <ErrorNote className="mx-6 mt-2" message={error} />
      <div className="flex items-center justify-end gap-2 px-6 pt-4 pb-6">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Connecting…' : `Connect ${proposal.name}`}</Button>
      </div>
    </form>
  </DialogCard>
}
