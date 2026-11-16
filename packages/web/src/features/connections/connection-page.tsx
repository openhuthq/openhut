import type { Agent, Grant } from '@openhut/common/agents/agent.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { Creature } from '@/components/creature'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Fact, Facts } from '@/components/facts'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { OwnerChip } from '@/components/owner-chip'
import { ButtonLabel, Page } from '@/components/page'
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
      <Button type="button" variant="secondary" disabled={!owned || authorize.isPending} onClick={() => authorize.mutate({ connectionId: connection.id }, { onError: toastError })}>
        {ICONS.ext}<ButtonLabel>{authorize.isPending ? 'Opening…' : 'Reconnect'}</ButtonLabel>
      </Button>
    </Locked>}
    <Locked reason={connection.canDelete ? undefined : `Only ${connection.ownerName} or an admin can delete it`}>
      <ConfirmButton disabled={!connection.canDelete} question={`Delete ${connection.name}?`} detail="Every agent loses it on its next call." action="Delete" onConfirm={() => deleteConnection.mutate(undefined, { onError: toastError })}>
        {ICONS.trash}<ButtonLabel>Delete</ButtonLabel>
      </ConfirmButton>
    </Locked>
  </>
  return <Page title={connection.name} parents={PARENTS} actions={actions}>
    <div className="mx-auto grid w-full max-w-[1152px] grid-cols-[minmax(0,1fr)_380px] gap-6 mobile:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-6">
        <ErrorNote message={returned} />
        {connected && <Alert variant="success" role="status">
          <span className="relative shrink-0"><Mark name={connection.kind} size={48} variant="connected" /><span className="absolute -right-1.5 -bottom-1.5 grid size-[22px] place-items-center rounded-full bg-pass text-white shadow-[0_0_0_3px_#ecfdf5] [&_svg]:size-[11px]">{ICONS.check}</span></span>
          <div className="min-w-0 flex-1"><h3 className="m-0 font-display text-[28px]/none font-normal tracking-[.01em] uppercase">{titleOf(connection.kind)} is connected</h3><p className="mt-1 mb-0 text-sm text-success-strong">Next, grant it to an agent from the agent's page.</p></div>
          <a className={buttonVariants({ variant: 'primary' })} href="/agents">Go to agents</a>
        </Alert>}
        {connection.usable && <Tools connectionId={connection.id} />}
        <Activity connectionId={connection.id} agents={agents.data ?? []} />
      </div>
      <aside className="flex min-w-0 flex-col gap-6 mobile:-order-1">
        <Facts>
          <Fact label="Service"><span className="inline-flex items-center gap-2"><Mark name={connection.kind} size={20} variant="kind" />{titleOf(connection.kind)}</span></Fact>
          {connection.account && <Fact label="Account"><span className="truncate" title={connection.account}>{connection.account}</span></Fact>}
          <Fact label="Added"><span>{shortDate.format(new Date(connection.createdAt))}</span></Fact>
          <Fact label="Owner"><OwnerChip id={connection.ownerId} name={connection.ownerName} /></Fact>
          <Fact label="Status"><ConnectionHealth connection={connection} /></Fact>
        </Facts>
        <section>
          <SectionHead title="People" />
          <ItemGroup><Item size="sm">
            <ItemContent><div>Everyone on the team</div><div className="text-mute">Now and anyone added later</div></ItemContent>
            <Locked reason={owned ? undefined : `Only ${connection.ownerName} can share it`}>
              <Switch checked={connection.everyone} aria-label="Everyone on the team" disabled={!owned || updateConnection.isPending}
                onCheckedChange={() => updateConnection.mutate({ everyone: !connection.everyone }, { onError: toastError })} />
            </Locked>
          </Item></ItemGroup>
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
      ? <Collapsible defaultOpen={loaded.length <= 6}>
        <CollapsibleTrigger nativeButton={false} render={<div />} className="mb-2 w-fit cursor-pointer text-sm text-mute [display:list-item] [list-style:disclosure-closed_inside] data-panel-open:hidden">{loaded.length <= 6 ? 'Tools' : `Show all ${loaded.length} tools`}</CollapsibleTrigger>
        <CollapsibleContent><ItemGroup>{loaded.map((tool) => <Item key={tool.name}>
          <ItemContent><div className="font-mono text-xs">{tool.name}</div>{tool.description && <div className="line-clamp-2 text-sm text-mute">{tool.description}</div>}</ItemContent>
        </Item>)}</ItemGroup></CollapsibleContent>
      </Collapsible>
      : <p className="m-0 text-mute">It lists no tools.</p>}</Loaded>
  </section>
}

function Activity({ connectionId, agents }: { connectionId: string; agents: Agent[] }) {
  const events = useConnectionEvents(connectionId)
  return <section>
    <SectionHead title="Activity" />
    <Loaded query={events}>{({ pages }) => {
      const calls = pages.flatMap((page) => page.data)
      if (!calls.length) return <p className="m-0 text-mute">No calls yet.</p>
      return <ItemGroup>{calls.map((call) => <Item key={call.id}>
        <Creature id={call.agentId} about={agents.find((agent) => agent.id === call.agentId)?.instructions} size={22} label={call.agentName} />
        <ItemContent><div className="truncate">{call.reason}</div><div className="truncate text-mute">{call.agentName}</div></ItemContent>
        {call.outcome !== 'allowed' && <StatusBadge status={call.outcome} />}
        <span className="font-mono text-xs text-mute">{ago(call.at)} ago</span>
      </Item>)}</ItemGroup>
    }}</Loaded>
    {events.hasNextPage && <Button type="button" variant="secondary" size="sm" className="mt-2 self-start" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Show more</Button>}
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
  if (!grants.length) return <p className="m-0 text-mute">No agent can use it yet. Grant it from an agent's page, under Connections.</p>
  return <ItemGroup>{grants.map((grant) => {
    const agent = agents.find((each) => each.id === grant.agentId)
    return <Item size="sm" key={grant.id}>
      <Creature id={grant.agentId} about={agent?.instructions} size={28} />
      <ItemContent>{agent?.name ?? "An agent you can't see"}</ItemContent>
      <Button type="button" size="icon-sm" title="Remove" aria-label={`Remove ${agent?.name ?? 'the agent'}`} disabled={deleteGrant.isPending} onClick={() => deleteGrant.mutate(grant, { onError: toastError })}>{ICONS.x}</Button>
    </Item>
  })}</ItemGroup>
}
