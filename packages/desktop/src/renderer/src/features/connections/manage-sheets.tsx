import { useState } from 'react'
import type { Connection } from '@openhut/common/connections/connection.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ConfirmButton } from '@/components/confirm-button'
import { Loaded } from '@/components/loaded'
import { StatusBadge } from '@/components/status-badge'
import { useAgents, useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { useAuthorizeConnection, useBackToAsker, useConnectionEvents, useConnections, useConnectionTools, useDeleteConnection } from '@/features/connections/api'
import { asked } from '@/features/connections/asked'
import { integration, titleOf } from '@/features/connections/catalog'
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
  if (!agents.length) return <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">No agents yet.</p>
  return <>{agents.map((agent) => {
    const grant = grants.data?.find((each) => each.agentId === agent.id)
    return <AgentCheck key={agent.id} agent={agent} checked={!!grant} disabled={!grants.data || !agent.canEdit || busy}
      onChange={() => grant ? deleteGrant.mutate(grant, { onError: toastError }) : createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })} />
  })}</>
}

export function Faces({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const grants = useGrants({ connectionId: connection.id })
  const users = agents.filter((agent) => grants.data?.some((grant) => grant.agentId === agent.id))
  if (!grants.data) return null
  if (!users.length) return <span className="text-xs text-mute-2">No agents</span>
  return <span className="flex -space-x-1.5" title={users.map((agent) => agent.name).join(', ')}>{users.map((agent) => <span key={agent.id} className="rounded-md bg-card shadow-[0_0_0_2px_var(--card)]"><Face agent={agent} size={24} /></span>)}</span>
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
  const askedBy = editable.find((agent) => agent.id === asked.by(connection.kind))
  const [picked, setPicked] = useState<string[]>(askedBy ? [askedBy.id] : editable.slice(0, 1).map((agent) => agent.id))
  const item = integration(connection.kind)
  const toAsker = useBackToAsker()
  const back = () => askedBy && picked.includes(askedBy.id) ? toAsker({ agentId: askedBy.id, name: connection.name }) : close()
  const done = () => Promise.all(picked.map((agentId) => createGrant.mutateAsync({ agentId, connectionId: connection.id }))).then(back, toastError)
  return <SetupSheet brand={connection.kind} title={`Who can use ${connection.name}`} blurb={item?.short ?? ''} onClose={close}
    foot={<Button variant="primary" disabled={createGrant.isPending} onClick={() => void done()}>Done</Button>}>
    <Success>{successLine(connection)}</Success>
    <div className="flex animate-grow flex-col gap-3">
      <div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-1">
        {editable.length ? editable.map((agent) => <AgentCheck key={agent.id} agent={agent} checked={picked.includes(agent.id)} onChange={() => setPicked(picked.includes(agent.id) ? picked.filter((id) => id !== agent.id) : [...picked, agent.id])} />)
          : <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">No agents yet. Come back here once you make one.</p>}
      </div>
    </div>
  </SetupSheet>
}

function successLine(connection: Connection) {
  if (connection.signIn && connection.account) return `Signed in as ${connection.account}`
  if (connection.kind === 'postgres') return `${connection.name} is connected. Read-only.`
  return `${connection.name} is connected.`
}

function ManageSheet({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  const remove = useDeleteConnection(connection)
  const authorize = useAuthorizeConnection()
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  return <SetupSheet brand={connection.kind} title={connection.name} blurb={[titleOf(connection.kind), connection.account].filter(Boolean).join(' · ')} error={returned} onClose={close}
    safe={`Added ${shortDate.format(new Date(connection.createdAt))}`}
    foot={<>
      <ConfirmButton variant="danger" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent stops being able to use it." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })}>Delete</ConfirmButton>
      {connection.signIn && <Button variant="secondary" disabled={authorize.isPending} onClick={() => authorize.mutate({ connectionId: connection.id }, { onError: toastError })}>{authorize.isPending ? 'Opening…' : 'Reconnect'}</Button>}
      <Button variant="primary" onClick={close}>Done</Button>
    </>}>
    <ItemGroup className="rounded-lg">
      <Item size="sm"><ItemContent stacked><ItemTitle>Status</ItemTitle><ItemDescription className="text-xs">{connection.lastSuccessAt ? `Last worked ${ago(connection.lastSuccessAt)} ago` : 'Not used yet'}</ItemDescription></ItemContent><StatusBadge status={connection.status} /></Item>
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
        {call.outcome !== 'allowed' && <StatusBadge status={call.outcome} />}
        <span className="font-mono text-xs text-mute">{ago(call.at)}</span>
      </Item>)}</ItemGroup>
    }}</Loaded>
  </Section>
}
