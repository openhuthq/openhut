import type { Agent, Grant } from '@jakebox/common/agents/agent.ts'
import type { Connection } from '@jakebox/common/connections/connection.ts'
import type { Me } from '@jakebox/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { OwnerChip } from '@/components/owner-chip'
import { Page } from '@/components/page'
import { SectionHead } from '@/components/section-head'
import { StatusBadge } from '@/components/status-badge'
import { useAgents, useConnection, useConnectionEvents, useDeleteConnection, useDeleteGrant, useGrants, useUpdateConnection } from '@/features/connections/api'
import { ConnectionHealth } from '@/features/connections/connection-health'
import { ago, shortDate } from '@/lib/format'
import { toastError } from '@/lib/toast'

const PARENTS = [{ label: 'Connections', href: '/connections' }]

export function ConnectionPage({ me, connectionId }: { me: Me; connectionId: string }) {
  const connection = useConnection(connectionId)
  if (!connection.data) return <Page title="Connection" parents={PARENTS}><ErrorNote message={connection.error?.message} /></Page>
  return <ConnectionView me={me} connection={connection.data} />
}

function ConnectionView({ me, connection }: { me: Me; connection: Connection }) {
  const agents = useAgents()
  const updateConnection = useUpdateConnection(connection.id)
  const deleteConnection = useDeleteConnection(connection.id)
  const owned = connection.ownerId === me.user.id
  const actions = <Locked reason={connection.canDelete ? undefined : `Only ${connection.ownerName} or an admin can delete it`}>
    <ConfirmButton className="btn danger" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent loses it on its next call." action="Delete" onConfirm={() => deleteConnection.mutate(undefined, { onError: toastError })}>
      {ICONS.trash}<span className="lbl">Delete</span>
    </ConfirmButton>
  </Locked>
  return <Page title={connection.name} parents={PARENTS} actions={actions}>
    <div className="detail wide">
      <div className="left"><Activity connectionId={connection.id} agents={agents.data ?? []} /></div>
      <aside className="rail">
        <div className="box facts">
          <div><span>Added</span><span>{shortDate.format(new Date(connection.createdAt))}</span></div>
          <div><span>Owner</span><OwnerChip id={connection.ownerId} name={connection.ownerName} /></div>
          <div><span>Status</span><ConnectionHealth connection={connection} /></div>
        </div>
        <section>
          <SectionHead title="People" />
          <div className="box rows"><div className="row">
            <div className="t"><div>Everyone on the team</div><div className="mute">Now and anyone added later</div></div>
            <Locked reason={owned ? undefined : `Only ${connection.ownerName} can share it`}>
              <button className="sw" role="switch" aria-checked={connection.everyone} aria-label="Everyone on the team" disabled={!owned || updateConnection.isPending}
                onClick={() => updateConnection.mutate({ everyone: !connection.everyone }, { onError: toastError })}></button>
            </Locked>
          </div></div>
        </section>
        <GrantedAgents connectionId={connection.id} agents={agents.data ?? []} />
      </aside>
    </div>
  </Page>
}

function Activity({ connectionId, agents }: { connectionId: string; agents: Agent[] }) {
  const events = useConnectionEvents(connectionId)
  return <section>
    <SectionHead title="Activity" />
    <Loaded query={events}>{({ pages }) => {
      const calls = pages.flatMap((page) => page.data)
      if (!calls.length) return <p className="note">No calls yet.</p>
      return <div className="box rows">{calls.map((call) => <div className="row" key={call.id}>
        <Avatar id={call.agentId} about={agents.find((agent) => agent.id === call.agentId)?.instructions} size={22} label={call.agentName} />
        <div className="t"><div className="ellip">{call.reason}</div><div className="mute ellip">{call.agentName}</div></div>
        {call.outcome !== 'allowed' && <StatusBadge status={call.outcome} />}
        <span className="mono mute">{ago(call.at)} ago</span>
      </div>)}</div>
    }}</Loaded>
    {events.hasNextPage && <button type="button" className="btn sec sm more" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Show more</button>}
  </section>
}

function GrantedAgents({ connectionId, agents }: { connectionId: string; agents: Agent[] }) {
  const grants = useGrants(connectionId)
  return <section>
    <SectionHead title="Agents" />
    <Loaded query={grants}>{(loaded) => <GrantList grants={loaded} agents={agents} />}</Loaded>
  </section>
}

function GrantList({ grants, agents }: { grants: Grant[]; agents: Agent[] }) {
  const deleteGrant = useDeleteGrant()
  if (!grants.length) return <p className="note">No agent can use it yet. Grant it from an agent's page, under Connections.</p>
  return <div className="box rows">{grants.map((grant) => {
    const agent = agents.find((each) => each.id === grant.agentId)
    return <div className="row" key={grant.id}>
      <Avatar id={grant.agentId} about={agent?.instructions} size={28} />
      <div className="t">{agent?.name ?? "An agent you can't see"}</div>
      <button type="button" className="btn ghost sm" disabled={deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}>Remove</button>
    </div>
  })}</div>
}
