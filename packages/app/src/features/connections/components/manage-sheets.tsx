import { useState, type FormEvent } from 'react'
import { ToolGroup, type Connection } from '@openhut/common/connections/connection.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { Button, buttonVariants } from '@/components/ui/button'
import { Menu } from '@base-ui/react/menu'
import { DropdownMenuContent, menuItemVariants } from '@/components/ui/dropdown-menu'
import { Face } from '@/components/agent-face'
import { ConfirmButton } from '@/components/confirm-button'
import { Loaded } from '@/components/loaded'
import { ArrowDown01Icon, RefreshIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useCreateGrant, useDeleteGrant, useGrants } from '@/lib/queries/grants'
import { useAgents } from '@/lib/queries/agents'
import { agentPath } from '@/config/paths'
import { openSignInTab, useAuthorizeConnection, useDeleteConnection, useReconnect } from '@/features/connections/api/connections'
import { useConnections, useConnectionTools } from '@/lib/queries/connections'
import { connectionBrand, integration, kindNote } from '@/config/catalog'
import { I, PILL, Section, SetupSheet, AgentCheck } from '@/components/kit'
import { Field, Success } from '@/components/sheet'
import { Input } from '@/components/ui/input'
import { fieldError, formError } from '@/lib/api-client'
import { GROUPS, GroupIcon } from '@/features/connections/components/permissions'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'

const close = () => navigate('/connections')

const KEY_FIELDS: Partial<Record<Connection['kind'], { name: 'dsn' | 'deployKey' | 'token'; label: string; placeholder: string }>> = {
  postgres: { name: 'dsn', label: 'New connection string', placeholder: 'postgres://reader:…@host:5432/db' },
  convex: { name: 'deployKey', label: 'New deploy key', placeholder: 'Paste the deploy key' },
  mcp: { name: 'token', label: 'New token', placeholder: 'Paste the new token' },
}

export function AgentGrants({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const grants = useGrants({ connectionId: connection.id })
  const createGrant = useCreateGrant()
  const deleteGrant = useDeleteGrant()
  const saving = (agentId: string) => (createGrant.isPending && createGrant.variables.agentId === agentId) || (deleteGrant.isPending && deleteGrant.variables.agentId === agentId)
  if (!agents.length) return <EmptyState inline line="No agents yet." />
  const granted = agents.filter((agent) => grants.data?.some((each) => each.agentId === agent.id))
  const summary = !granted.length ? 'No agents yet' : granted.length === 1 ? granted[0].name : `${granted[0].name} and ${granted.length - 1} more`
  return <Menu.Root>
    <Menu.Trigger aria-label="Who can use it" className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-hair bg-card px-2.5 text-left text-[13px] text-ink hover:bg-hover data-popup-open:bg-hover">
      {granted.length > 0 && <span className="flex shrink-0">{granted.slice(0, 4).map((agent, index) => <Face key={agent.id} agent={agent} size={24} className={cn('rounded-full ring-2 ring-card', index > 0 && '-ml-1.5')} />)}</span>}
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      <I icon={ArrowDown01Icon} size={14} className="text-mute" />
    </Menu.Trigger>
    <DropdownMenuContent className="min-w-(--anchor-width)">{agents.map((agent) => {
      const grant = grants.data?.find((each) => each.agentId === agent.id)
      return <div key={agent.id} className="flex items-center gap-1">
        <Menu.CheckboxItem closeOnClick={false} checked={!!grant} disabled={!grants.data || !agent.canEdit || saving(agent.id)} className={cn(menuItemVariants({ size: 'tall' }), 'min-w-0 flex-1')}
          onCheckedChange={() => grant ? deleteGrant.mutate(grant, { onError: toastError }) : createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })}>
          <span className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-mid data-checked:border-ink data-checked:bg-ink" data-checked={grant ? '' : undefined}><Menu.CheckboxItemIndicator className="flex text-white"><I icon={Tick02Icon} size={11} /></Menu.CheckboxItemIndicator></span>
          <Face agent={agent} size={24} />
          <span className="grid min-w-0 leading-tight"><span className="truncate text-[13px] text-ink">{agent.name}</span><span className="truncate text-[11.5px] text-mute">{agent.instructions.split('\n')[0] || 'No instructions yet'}</span></span>
        </Menu.CheckboxItem>
        {grant && <a href={agentPath({ agentId: agent.id, dialog: 'apps', detail: connection.id })} className={cn(buttonVariants({ variant: 'ghost' }), PILL, 'shrink-0')}>Permissions</a>}
      </div>
    })}</DropdownMenuContent>
  </Menu.Root>
}

export function ConnectionSheet({ connectionId, connected }: { connectionId: string; connected: boolean }) {
  const connections = useConnections()
  const agents = useAgents()
  const connection = connections.data?.find((each) => each.id === connectionId)
  if (connections.data && !connection) return <SetupSheet brand="mcp" title="Connection" blurb="That connection doesn't exist anymore." onClose={close} foot={<Button variant="secondary" onClick={close}>Close</Button>} />
  if (!connection || !agents.data) return null
  const props = { connection, agents: agents.data }
  return connected ? <AccessSheet {...props} /> : <ManageSheet {...props} />
}

function AccessSheet({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const createGrant = useCreateGrant()
  const editable = agents.filter((agent) => agent.canEdit)
  const [picked, setPicked] = useState<string[]>(editable.slice(0, 1).map((agent) => agent.id))
  const item = integration(connection.kind)
  const done = () => Promise.all(picked.map((agentId) => createGrant.mutateAsync({ agentId, connectionId: connection.id }))).then(close, toastError)
  return <SetupSheet brand={connectionBrand(connection)} title={`Who can use ${connection.name}`} blurb={item?.short ?? ''} onClose={close}
    foot={<Button variant="primary" disabled={createGrant.isPending} onClick={() => void done()}>Done</Button>}>
    <Success>{successLine(connection)}</Success>
    <div className="flex animate-grow flex-col gap-3">
      <div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-1">
        {editable.length ? editable.map((agent) => <AgentCheck key={agent.id} agent={agent} checked={picked.includes(agent.id)} onChange={() => setPicked(picked.includes(agent.id) ? picked.filter((id) => id !== agent.id) : [...picked, agent.id])} />)
          : <EmptyState inline line="No agents yet. Come back here once you make one." />}
      </div>
    </div>
  </SetupSheet>
}

function successLine(connection: Connection) {
  if (connection.signIn && connection.account) return `Signed in as ${connection.account}`
  if (connection.kind === 'postgres' && connection.account.endsWith(' · can write')) return `${connection.name} is connected. Agents only read, but this user can change data. Connect with a read-only user to be safe.`
  if (connection.kind === 'postgres') return `${connection.name} is connected. Read-only.`
  return `${connection.name} is connected.`
}

const PROBLEMS: Record<Exclude<Connection['status'], 'connected'>, { title: string; note: string }> = {
  signed_out: { title: 'Sign-in expired', note: 'Reconnect to keep using it.' },
  rejected: { title: 'Login rejected', note: 'Reconnect to fix it.' },
  failing: { title: 'Not working lately', note: 'Its last few calls didn’t go through. Reconnect if it keeps happening.' },
}

function ManageSheet({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const remove = useDeleteConnection(connection)
  const authorize = useAuthorizeConnection({ stay: true })
  const reconnect = useReconnect(connection)
  const [keying, setKeying] = useState(false)
  const problem = connection.status === 'connected' ? undefined : PROBLEMS[connection.status]
  const field = KEY_FIELDS[connection.kind]
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  const start = () => {
    if (connection.signIn) authorize.mutate({ connectionId: connection.id, tab: openSignInTab() }, { onSuccess: (done) => { if (done) toast(`${connection.name} is reconnected`) }, onError: toastError })
    else if (field) setKeying(true)
    else reconnect.mutate({}, { onSuccess: () => toast(`${connection.name} is reconnected`), onError: toastError })
  }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (field) reconnect.mutate({ [field.name]: String(new FormData(event.currentTarget).get(field.name) ?? '') }, { onSuccess: () => { setKeying(false); toast(`${connection.name} is reconnected`) } })
  }
  const label = authorize.isPending ? 'Finish in your browser…' : 'Reconnect'
  const blurb = problem ? <span className="flex min-w-0 items-center gap-1.5" title={problem.note}>
    <span className="size-1.5 shrink-0 rounded-full bg-hue-amber" /><span className="shrink-0 font-medium text-hue-amber">{problem.title}</span><span className="text-mute">·</span><span className="truncate">{kindNote(connection)}</span>
  </span> : kindNote(connection)
  const action = <Button variant="secondary" aria-expanded={field ? keying : undefined} disabled={authorize.isPending || reconnect.isPending} onClick={() => keying ? setKeying(false) : start()}
    className={cn('shrink-0 gap-1.5 text-[13px]', problem && 'bg-[color-mix(in_oklch,var(--hue-amber)_16%,transparent)] text-[color-mix(in_oklch,var(--hue-amber)_60%,black)] hover:bg-[color-mix(in_oklch,var(--hue-amber)_24%,transparent)]')}>
    <I icon={RefreshIcon} size={14} />{label}
  </Button>
  return <SetupSheet brand={connectionBrand(connection)} title={connection.name} blurb={blurb} action={action} error={returned ?? formError(reconnect.error, field ? [field.name] : [])} onClose={close}
    safe={`Added ${shortDate.format(new Date(connection.createdAt))}`}
    foot={<>
      <ConfirmButton variant="danger" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent stops being able to use it." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })}>Delete</ConfirmButton>
      <Button variant={keying ? 'secondary' : 'primary'} onClick={close}>Done</Button>
    </>}>
    {keying && field && <form onSubmit={save} className="flex animate-grow flex-col gap-2 rounded-lg border border-hair bg-tint p-3">
      <Field label={problem ? `${problem.title}. ${field.label}` : field.label} error={fieldError(reconnect.error, field.name)}>
        <span className="flex gap-2"><Input mono name={field.name} type="password" required autoFocus autoComplete="off" placeholder={field.placeholder} className="min-w-0 flex-1" />
          <Button type="button" variant="ghost" onClick={() => setKeying(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={reconnect.isPending}>{reconnect.isPending ? 'Checking…' : 'Save'}</Button></span>
      </Field>
    </form>}
    <Section title="Who can use it"><AgentGrants connection={connection} agents={agents} /></Section>
    <Tools connection={connection} />
  </SetupSheet>
}

function Tools({ connection }: { connection: Connection }) {
  const tools = useConnectionTools(connection)
  const list = tools.data ?? []
  const catchAll = list.find((tool) => tool.kind === 'catch_all')
  const shown = list.filter((tool) => tool.kind !== 'catch_all')
  const actions = list.filter((tool) => tool.kind === 'action').length
  const groups = ToolGroup.options.map((group) => ({ group, members: shown.filter((tool) => tool.group === group) })).filter((each) => each.members.length)
  const count = catchAll ? `reaches ${actions} ${actions === 1 ? 'action' : 'actions'}` : tools.data?.length
  return <Section title="What agents can do" action={<span className="font-medium text-mute">{count}</span>}>
    <Loaded query={tools}>{() => <div className="flex flex-col gap-3 px-0.5">
      {groups.map(({ group, members }) => <div key={group} className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink" title={GROUPS[group].line}><GroupIcon group={group} />{GROUPS[group].label}</span>
        <div className="flex flex-wrap gap-1">{members.map((tool) => <Badge key={tool.name} variant="tag" title={tool.description}>{tool.label}</Badge>)}</div>
      </div>)}
      {catchAll && !actions && <p className="m-0 text-[12.5px] text-mute">{catchAll.label}. Agents haven't used one yet.</p>}
      {!list.length && <p className="m-0 text-[12.5px] text-mute">It lists no tools.</p>}
    </div>}</Loaded>
  </Section>
}
