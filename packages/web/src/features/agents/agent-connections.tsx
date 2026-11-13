import { Menu } from '@base-ui/react/menu'
import type { Agent, Grant } from '@fastmonkey/common/agents/agent.ts'
import type { Connection } from '@fastmonkey/common/connections/connection.ts'
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
    {!added.length && <p className="note">{agent.name} can't use any connection yet.</p>}
    {added.length > 0 && <div className="box rows">{added.map(({ grant, connection }) => <div className="row" key={grant.id}>
      <Mark name={connection.kind} size={24} />
      <div className="t ellip">{connection.name}</div>
      <Locked reason={lockReason}>
        <button type="button" className="btn icon sm" title="Remove" aria-label={`Remove ${connection.name}`} disabled={!!lockReason || deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}>{ICONS.x}</button>
      </Locked>
    </div>)}</div>}
  </section>
}

function AddConnection({ agent, connections, lockReason }: { agent: Agent; connections: Connection[]; lockReason: string | undefined }) {
  const createGrant = useCreateGrant()
  return <Locked reason={lockReason}>
    <Menu.Root>
      <Menu.Trigger className="btn sm" disabled={!!lockReason || createGrant.isPending}>{ICONS.plus}Add</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menupos" side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu">
            {connections.map((connection) => {
              const blocked = blockedReason(agent, connection)
              return <Menu.Item className="menuitem tall" key={connection.id} disabled={!!blocked} onClick={() => createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })}>
                <Mark name={connection.kind} size={24} />
                <span className="t"><span className="ellip">{connection.name}</span>{blocked && <span className="mute">{blocked}</span>}</span>
              </Menu.Item>
            })}
            {connections.length > 0 && <Menu.Separator className="menusep" />}
            <Menu.Item className="menuitem" onClick={() => navigate('/connections')}>{ICONS.plus}New connection</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  </Locked>
}

function blockedReason(agent: Agent, connection: Connection) {
  if (!connection.usable) return `Private to ${connection.ownerName}. Only ${connection.ownerName} can share it.`
  if (!connection.everyone && connection.ownerId !== agent.ownerId) return `${agent.ownerName} owns ${agent.name} and can't use ${connection.name}.`
  return undefined
}
