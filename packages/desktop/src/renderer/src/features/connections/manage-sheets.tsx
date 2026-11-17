import { useState } from 'react'
import type { OpenHutAgent, OpenHutConnection } from '@openhut/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ConfirmButton } from '@/components/confirm-button'
import { Loaded } from '@/components/loaded'
import { StatusBadge } from '@/components/status-badge'
import { useAgents, useConnectionGrants, useCreateGrant, useDeleteGrant } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { useAuthorizeConnection, useConnectionEvents, useConnections, useConnectionTools, useDeleteConnection } from '@/features/connections/api'
import { connectionOf, copyOn } from '@/features/connections/copies'
import { integration, titleOf } from '@/features/connections/catalog'
import { Section, SetupSheet } from '@/components/kit'
import { Success } from '@/features/connections/sheet'
import { AgentCheck } from '@/features/settings/kit'
import { ago, shortDate } from '@/lib/format'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const close = () => navigate('/connections')

export function AgentGrants({ connection, agents }: { connection: OpenHutConnection; agents: OpenHutAgent[] }) {
  const grants = useConnectionGrants(connection)
  const createGrant = useCreateGrant()
  const deleteGrant = useDeleteGrant()
  const busy = createGrant.isPending || deleteGrant.isPending
  if (!agents.length) return <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">No agents yet.</p>
  return <>{agents.map((agent) => {
    const grant = grants.data?.find((each) => each.agentId === agent.id)
    const here = copyOn({ connection, computer: agent.computer })
    return <AgentCheck key={agent.id} agent={agent} checked={!!grant} disabled={!grants.data || !agent.canEdit || !here || busy}
      onChange={() => grant ? deleteGrant.mutate(grant, { onError: toastError }) : here && createGrant.mutate({ agentId: agent.id, connectionId: here }, { onError: toastError })} />
  })}</>
}

export function Faces({ connection, agents }: { connection: OpenHutConnection; agents: OpenHutAgent[] }) {
  const grants = useConnectionGrants(connection)
  const users = agents.filter((agent) => grants.data?.some((grant) => grant.agentId === agent.id))
  if (!grants.data) return null
  if (!users.length) return <span className="text-xs text-mute-2">No agents</span>
  return <span className="flex -space-x-1.5" title={users.map((agent) => agent.name).join(', ')}>{users.map((agent) => <span key={agent.id} className="rounded-md bg-card shadow-[0_0_0_2px_var(--card)]"><Face agent={agent} size={24} /></span>)}</span>
}

export function ConnectionSheet({ connectionId, connected }: { connectionId: string; connected: boolean }) {
  const connections = useConnections()
  const agents = useAgents()
  const connection = connectionOf({ connections: connections.data, id: connectionId })
  if (connections.data && !connection) return <SetupSheet brand="mcp" title="Connection" blurb="That connection isn't on any of your computers anymore." onClose={close} foot={<Button variant="secondary" onClick={close}>Close</Button>} />
  if (!connection || !agents.data) return null
  const props = { connection, agents: agents.data }
  return connected ? <AccessSheet {...props} /> : <ManageSheet {...props} />
}

function AccessSheet({ connection, agents }: { connection: OpenHutConnection; agents: OpenHutAgent[] }) {
  const createGrant = useCreateGrant()
  const editable = agents.filter((agent) => agent.canEdit && copyOn({ connection, computer: agent.computer }))
  const [picked, setPicked] = useState<string[]>(editable.slice(0, 1).map((agent) => agent.id))
  const item = integration(connection.kind)
  const done = () => Promise.all(picked.map((agentId) => createGrant.mutateAsync({ agentId, connectionId: connection.id }))).then(close, toastError)
  return <SetupSheet brand={connection.kind} title={`Who can use ${connection.name}`} blurb={item?.short ?? ''} onClose={close}
    foot={<Button variant="primary" disabled={createGrant.isPending} onClick={() => void done()}>Done</Button>}>
    <Success>{successLine(connection)}</Success>
    <div className="flex animate-grow flex-col gap-3">
      <div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-1">
        {editable.length ? editable.map((agent) => <AgentCheck key={agent.id} agent={agent} checked={picked.includes(agent.id)} onChange={() => setPicked(picked.includes(agent.id) ? picked.filter((id) => id !== agent.id) : [...picked, agent.id])} />)
          : <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">You have no agents yet. Grant it from here once you make one.</p>}
      </div>
    </div>
  </SetupSheet>
}

function successLine(connection: OpenHutConnection) {
  if (connection.signIn && connection.account) return `Signed in as ${connection.account}`
  if (connection.kind === 'postgres') return `${connection.name} is connected. Read-only.`
  return `${connection.name} is connected.`
}

function ManageSheet({ connection, agents }: { connection: OpenHutConnection; agents: OpenHutAgent[] }) {
  const remove = useDeleteConnection(connection)
  const authorize = useAuthorizeConnection()
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  return <SetupSheet brand={connection.kind} title={connection.name} blurb={[titleOf(connection.kind), connection.account].filter(Boolean).join(' · ')} error={returned} onClose={close}
    safe={`Added ${shortDate.format(new Date(connection.createdAt))}`}
    foot={<>
      <ConfirmButton variant="secondary" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent loses it on its next call." action="Delete" onConfirm={() => remove.mutate(undefined, { onError: toastError })}>Delete</ConfirmButton>
      {connection.signIn && <Button variant="secondary" disabled={authorize.isPending} onClick={() => authorize.mutate({ connectionId: connection.id }, { onError: toastError })}>{authorize.isPending ? 'Opening…' : 'Reconnect'}</Button>}
      <Button variant="primary" onClick={close}>Done</Button>
    </>}>
    <ItemGroup className="rounded-lg">
      <Item size="sm"><ItemContent stacked><ItemTitle>Status</ItemTitle><ItemDescription className="text-xs">{connection.lastSuccessAt ? `Last good call ${ago(connection.lastSuccessAt)} ago` : 'No calls yet'}</ItemDescription></ItemContent><StatusBadge status={connection.status} /></Item>
    </ItemGroup>
    <Section title="Who can use it"><div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-1"><AgentGrants connection={connection} agents={agents} /></div></Section>
    {connection.usable && <Tools connection={connection} />}
    <Activity connection={connection} agents={agents} />
  </SetupSheet>
}

function Tools({ connection }: { connection: OpenHutConnection }) {
  const tools = useConnectionTools(connection)
  return <Section title="What agents can call" action={<span className="font-medium text-mute">{tools.data?.length}</span>}>
    <Loaded query={tools}>{(list) => list.length
      ? <div className="flex flex-wrap gap-1">{list.map((tool) => <Badge key={tool.name} variant="tag" title={tool.description} className="font-mono">{tool.name}</Badge>)}</div>
      : <p className="m-0 px-0.5 text-[12.5px] text-mute">It lists no tools.</p>}</Loaded>
  </Section>
}

function Activity({ connection, agents }: { connection: OpenHutConnection; agents: OpenHutAgent[] }) {
  const events = useConnectionEvents(connection)
  return <Section title="Activity">
    <Loaded query={events}>{(calls) => {
      if (!calls.length) return <p className="m-0 px-0.5 text-[12.5px] text-mute">No calls yet.</p>
      return <ItemGroup className="rounded-lg">{calls.map((call) => <Item key={call.id} size="sm">
        <Face agent={agents.find((agent) => agent.id === call.agentId) ?? { id: call.agentId, instructions: '' }} size={22} />
        <ItemContent stacked><ItemTitle className="text-[12.5px]"><span className="truncate">{call.reason}</span></ItemTitle><ItemDescription className="text-xs">{call.agentName} · {call.tool}</ItemDescription></ItemContent>
        {call.outcome !== 'allowed' && <StatusBadge status={call.outcome} />}
        <span className="font-mono text-xs text-mute">{ago(call.at)}</span>
      </Item>)}</ItemGroup>
    }}</Loaded>
  </Section>
}
