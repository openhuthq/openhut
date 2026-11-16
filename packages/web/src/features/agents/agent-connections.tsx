import type { Agent, Grant } from '@openhut/common/agents/agent.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { SectionHead } from '@/components/section-head'
import { useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

export function AgentConnections({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const connections = useConnections()
  const grants = useGrants({ agentId: agent.id })
  if (!connections.data || !grants.data) return <section><SectionHead title="Connections" /><ErrorNote message={connections.error?.message ?? grants.error?.message} /></section>
  return <ConnectionList agent={agent} connections={connections.data} grants={grants.data} lockReason={lockReason} />
}

function ConnectionList({ agent, connections, grants, lockReason }: { agent: Agent; connections: Connection[]; grants: Grant[]; lockReason: string | undefined }) {
  const deleteGrant = useDeleteGrant()
  const added = grants.flatMap((grant) => {
    const connection = connections.find((each) => each.id === grant.connectionId)
    return connection ? [{ grant, connection }] : []
  })
  const others = connections.filter((connection) => !grants.some((grant) => grant.connectionId === connection.id))
  return <section>
    <SectionHead title="Connections" action={<AddConnection agent={agent} connections={others} lockReason={lockReason} />} />
    {!added.length && <p className="m-0 text-mute">{agent.name} can't use any connection yet.</p>}
    {added.length > 0 && <ItemGroup>{added.map(({ grant, connection }) => <Item size="sm" key={grant.id}>
      <Mark name={connection.kind} size={24} />
      <ItemContent className="truncate">{connection.name}</ItemContent>
      <Locked reason={lockReason}>
        <Button type="button" size="icon-sm" title="Remove" aria-label={`Remove ${connection.name}`} disabled={!!lockReason || deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}>{ICONS.x}</Button>
      </Locked>
    </Item>)}</ItemGroup>}
  </section>
}

function AddConnection({ agent, connections, lockReason }: { agent: Agent; connections: Connection[]; lockReason: string | undefined }) {
  const createGrant = useCreateGrant()
  return <Locked reason={lockReason}>
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ size: 'sm' })} disabled={!!lockReason || createGrant.isPending}>{ICONS.plus}Add</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {connections.map((connection) => {
          const blocked = blockedReason(agent, connection)
          return <DropdownMenuItem size="tall" key={connection.id} disabled={!!blocked} onClick={() => createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })}>
            <Mark name={connection.kind} size={24} />
            <span className="flex min-w-0 flex-col"><span className="truncate">{connection.name}</span>{blocked && <span className="text-xs whitespace-normal text-mute">{blocked}</span>}</span>
          </DropdownMenuItem>
        })}
        {connections.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => navigate('/connections')}>{ICONS.plus}New connection</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Locked>
}

function blockedReason(agent: Agent, connection: Connection) {
  if (!connection.usable) return `Private to ${connection.ownerName}. Only ${connection.ownerName} can share it.`
  if (!connection.everyone && connection.ownerId !== agent.ownerId) return `${agent.ownerName} owns ${agent.name} and can't use ${connection.name}.`
  return undefined
}
