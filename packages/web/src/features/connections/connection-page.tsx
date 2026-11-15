import type { Agent, Grant } from '@openhut/common/agents/agent.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { OwnerChip } from '@/components/owner-chip'
import { Page } from '@/components/page'
import { SectionHead } from '@/components/section-head'
import { StatusBadge } from '@/components/status-badge'
import { useAgents, useDeleteGrant, useGrants } from '@/features/agents/api'
import { useAuthorizeConnection, useConnection, useConnectionEvents, useConnectionTools, useDeleteConnection, useUpdateConnection } from '@/features/connections/api'
import { titleOf } from '@/features/connections/catalog'
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
  const authorize = useAuthorizeConnection()
  const owned = connection.ownerId === me.user.id
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  const connected = new URLSearchParams(location.search).has('connected')
  const actions = <>
    {connection.signIn && <Locked reason={owned ? undefined : `Only ${connection.ownerName} can reconnect it`}>
      <button type="button" className="btn sec" disabled={!owned || authorize.isPending} onClick={() => authorize.mutate({ connectionId: connection.id }, { onError: toastError })}>
        {ICONS.ext}<span className="lbl">{authorize.isPending ? 'Opening…' : 'Reconnect'}</span>
      </button>
    </Locked>}
    <Locked reason={connection.canDelete ? undefined : `Only ${connection.ownerName} or an admin can delete it`}>
      <ConfirmButton className="btn danger" disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent loses it on its next call." action="Delete" onConfirm={() => deleteConnection.mutate(undefined, { onError: toastError })}>
        {ICONS.trash}<span className="lbl">Delete</span>
      </ConfirmButton>
    </Locked>
  </>
  return <Page title={connection.name} parents={PARENTS} actions={actions}>
    <div className="detail wide">
      <div className="left">
        <ErrorNote message={returned} />
        {connected && <div className="connected" role="status">
          <span className="connected-mark"><Mark name={connection.kind} size={48} /><span className="tick">{ICONS.check}</span></span>
          <div className="t"><h3>{titleOf(connection.kind)} is connected</h3><p>Next, grant it to an agent from the agent's page.</p></div>
          <a className="btn primary" href="/agents">Go to agents</a>
        </div>}
        {connection.usable && <Tools connectionId={connection.id} />}
        <Activity connectionId={connection.id} agents={agents.data ?? []} />
      </div>
      <aside className="rail">
        <div className="box facts">
          <div><span>Service</span><span className="kind"><Mark name={connection.kind} size={20} />{titleOf(connection.kind)}</span></div>
          {connection.account && <div><span>Account</span><span className="ellip" title={connection.account}>{connection.account}</span></div>}
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

function Tools({ connectionId }: { connectionId: string }) {
  const tools = useConnectionTools(connectionId)
  return <section>
    <SectionHead title={tools.data ? `What agents can call · ${tools.data.length}` : 'What agents can call'} />
    <Loaded query={tools}>{(loaded) => loaded.length
      ? <details className="tools" open={loaded.length <= 6}>
        <summary className="mute">{loaded.length <= 6 ? 'Tools' : `Show all ${loaded.length} tools`}</summary>
        <div className="box rows">{loaded.map((tool) => <div className="row" key={tool.name}>
          <div className="t"><div className="mono">{tool.name}</div>{tool.description && <div className="mute clamp">{tool.description}</div>}</div>
        </div>)}</div>
      </details>
      : <p className="note">It lists no tools.</p>}</Loaded>
  </section>
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
  const grants = useGrants({ connectionId })
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
      <button type="button" className="btn icon sm" title="Remove" aria-label={`Remove ${agent?.name ?? 'the agent'}`} disabled={deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}>{ICONS.x}</button>
    </div>
  })}</div>
}
