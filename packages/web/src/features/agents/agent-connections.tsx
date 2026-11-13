import type { Agent, Grant } from '@jakebox/common/agents/agent.ts'
import type { Connection } from '@jakebox/common/connections/connection.ts'
import { ErrorNote } from '@/components/error-note'
import { Mark } from '@/components/mark'
import { SectionHead } from '@/components/section-head'
import { useCreateGrant, useDeleteGrant, useGrants } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { toastError } from '@/lib/toast'

export function AgentConnections({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const connections = useConnections()
  const grants = useGrants({ agentId: agent.id })
  return <section>
    <SectionHead title="Connections" />
    <ErrorNote message={connections.error?.message ?? grants.error?.message} />
    {connections.data && grants.data && <ConnectionList agent={agent} connections={connections.data} grants={grants.data} lockReason={lockReason} />}
  </section>
}

function ConnectionList({ agent, connections, grants, lockReason }: { agent: Agent; connections: Connection[]; grants: Grant[]; lockReason: string | undefined }) {
  const createGrant = useCreateGrant()
  const deleteGrant = useDeleteGrant()
  if (!connections.length) return <p className="note">No connections yet. <a href="/connections/new">Add Postgres</a> first.</p>
  return <div className="box rows">{connections.map((connection) => {
    const grant = grants.find((each) => each.connectionId === connection.id)
    const blocked = blockedReason(agent, connection)
    const reason = blocked ?? lockReason
    const creating = createGrant.isPending && createGrant.variables.connectionId === connection.id
    const deleting = deleteGrant.isPending && deleteGrant.variables.connectionId === connection.id
    return <div className="row grant" key={connection.id}>
      <label className={reason ? 'chk off' : 'chk'} title={reason}>
        <input type="checkbox" checked={creating || (!!grant && !deleting)} disabled={!!reason || creating || deleting}
          onChange={(event) => {
            if (event.target.checked) createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError })
            else if (grant) deleteGrant.mutate(grant, { onError: toastError })
          }} />
        <Mark name={connection.kind} size={24} />
        <div className="t"><div className="ellip">{connection.name}</div>{blocked && <div className="mute ellip">{blocked}</div>}</div>
      </label>
    </div>
  })}</div>
}

function blockedReason(agent: Agent, connection: Connection) {
  if (!connection.usable) return `Private to ${connection.ownerName}. Only ${connection.ownerName} can share it.`
  if (!connection.everyone && connection.ownerId !== agent.ownerId) return `${agent.ownerName} owns ${agent.name} and can't use ${connection.name}.`
  return undefined
}
