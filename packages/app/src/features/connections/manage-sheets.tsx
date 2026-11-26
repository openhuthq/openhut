import { useState } from 'react'
import type { Connection } from '@openhut/common/connections/connection.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ConfirmButton } from '@/components/confirm-button'
import { Loaded } from '@/components/loaded'
import { StatusBadge } from '@/components/status-badge'
import { useAgents, useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { openSignInTab, useAuthorizeConnection, useConnectionEvents, useConnections, useConnectionTools, useDeleteConnection } from '@/features/connections/api'
import { connectionBrand, integration, kindNote } from '@/features/connections/catalog'
import { Section, SetupSheet } from '@/components/kit'
import { Success } from '@/features/connections/sheet'
import { AgentCheck } from '@/features/settings/kit'
import { ago, shortDate } from '@/lib/format'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const close = () => navigate('/connections')

export function AgentGrants({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const grants = useGrants({ connectionId: connection.id })
  const createGrant = useCreateGrant()
  const deleteGrant = useDeleteGrant()
  const busy = createGrant.isPending || deleteGrant.isPending
  if (!agents.length) return <EmptyState inline line="No agents yet." />
  return <>{agents.map((agent) => {
    const grant = grants.data?.find((each) => each.agentId === agent.id)
    return <AgentCheck key={agent.id} agent={agent} checked={!!grant} disabled={!grants.data || !agent.canEdit || busy}
      onChange={() => grant ? deleteGrant.mutate(grant, { onError: toastError }) : createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })} />
  })}</>
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
  if (connection.kind === 'postgres') return `${connection.name} is connected. Read-only.`
  return `${connection.name} is connected.`
}

function statusNote(connection: Connection) {
  const worked = connection.lastSuccessAt && `Last worked ${ago(connection.lastSuccessAt)} ago`
  if (connection.status === 'failing') return worked ? `Failed last time. ${worked}` : 'Every call so far failed'
  return worked || 'Not used yet'
}

function ManageSheet({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const remove = useDeleteConnection(connection)
  const authorize = useAuthorizeConnection()
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  return <SetupSheet brand={connectionBrand(connection)} title={connection.name} blurb={kindNote(connection)} error={returned} onClose={close}
    safe={`Added ${shortDate.format(new Date(connection.createdAt))}`}
    foot={<>
      <ConfirmButton variant="danger" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent stops being able to use it." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })}>Delete</ConfirmButton>
      {connection.signIn && <Button variant="secondary" disabled={authorize.isPending} onClick={() => authorize.mutate({ connectionId: connection.id, tab: openSignInTab() }, { onError: toastError })}>{authorize.isPending ? 'Finish in your browser…' : 'Reconnect'}</Button>}
      <Button variant="primary" onClick={close}>Done</Button>
    </>}>
    <ItemGroup className="rounded-lg">
      <Item size="sm"><ItemContent stacked><ItemTitle>Status</ItemTitle><ItemDescription className="text-xs">{statusNote(connection)}</ItemDescription></ItemContent><StatusBadge status={connection.status} /></Item>
    </ItemGroup>
    <Section title="Who can use it"><div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-1"><AgentGrants connection={connection} agents={agents} /></div></Section>
    <Tools connection={connection} />
    <Activity connection={connection} agents={agents} />
  </SetupSheet>
}

function Tools({ connection }: { connection: Connection }) {
  const tools = useConnectionTools(connection)
  return <Section title="What agents can do" action={<span className="font-medium text-mute">{tools.data?.length}</span>}>
    <Loaded query={tools}>{(list) => list.length
      ? <div className="flex flex-wrap gap-1">{list.map((tool) => <Badge key={tool.name} variant="tag" title={tool.description} className="font-mono">{tool.name}</Badge>)}</div>
      : <p className="m-0 px-0.5 text-[12.5px] text-mute">It lists no tools.</p>}</Loaded>
  </Section>
}

function Activity({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const events = useConnectionEvents(connection)
  return <Section title="Activity">
    <Loaded query={events}>{(calls) => {
      if (!calls.length) return <p className="m-0 px-0.5 text-[12.5px] text-mute">Nothing yet.</p>
      return <ItemGroup className="rounded-lg">{calls.map((call) => <Item key={call.id} size="sm">
        <Face agent={agents.find((agent) => agent.id === call.agentId) ?? { id: call.agentId, instructions: '' }} size={22} />
        <ItemContent stacked><ItemTitle className="text-[12.5px]"><span className="truncate">{call.reason}</span></ItemTitle><ItemDescription className="text-xs">{call.agentName} · {call.tool}</ItemDescription></ItemContent>
        {(call.outcome === 'denied' || call.outcome === 'failed') && <StatusBadge status={call.outcome} />}
        <span className="font-mono text-xs text-mute">{ago(call.at)}</span>
      </Item>)}</ItemGroup>
    }}</Loaded>
  </Section>
}
