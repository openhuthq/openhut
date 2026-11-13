import type { Connection, Tailscale } from '@fastmonkey/common/connections/connection.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { useConnections, useTailscale } from '@/features/connections/api'
import { SHELVES, integration, titleOf, type Integration } from '@/features/connections/catalog'
import { ConnectDialog } from '@/features/connections/connect-dialog'
import { ConnectionHealth } from '@/features/connections/connection-health'
import { plural } from '@/lib/format'

export function ConnectionsPage({ me, adding }: { me: Me; adding: string | undefined }) {
  const connections = useConnections()
  const tailscale = useTailscale()
  const list = connections.data ?? []
  const joined = tailscale.data?.connected
  const item = adding ? integration(adding) : undefined
  const returned = adding ? undefined : new URLSearchParams(location.search).get('error') ?? undefined
  return <Page title="Connections">
    <div className="market">
      <ErrorNote message={returned} />
      <section className="msec">
        <div className="shead"><h3>Connected <span className="count">{list.length + (joined ? 1 : 0)}</span></h3></div>
        <Loaded query={connections}>{(loaded) => <ConnectedList connections={loaded} tailscale={tailscale.data} me={me} />}</Loaded>
      </section>
      {SHELVES.map((shelf) => <section className="msec" key={shelf.shelf}>
        <div className="shead"><h3>{shelf.shelf}</h3></div>
        <div className="itemgrid">{shelf.items.map((each) => <CatalogItem key={each.name} item={each}
          connected={each.name === 'tailscale' ? !!joined : list.some((connection) => connection.kind === each.name)} />)}</div>
      </section>)}
    </div>
    {item && <ConnectDialog key={item.name} me={me} item={item} />}
  </Page>
}

function ConnectedList({ connections, tailscale, me }: { connections: Connection[]; tailscale: Tailscale | undefined; me: Me }) {
  const joined = tailscale?.connected
  if (!connections.length && !joined) return <p className="note">Nothing yet. Pick one below: each opens a short guide.</p>
  return <div className="lbox">
    {connections.map((connection) =>
      <a className={connection.usable ? 'lrow' : 'lrow dim'} href={`/connections/${connection.id}`} title={connection.usable ? undefined : `Private to ${connection.ownerName}`} key={connection.id}>
        <span className="itemark"><Mark name={connection.kind} size={32} /></span>
        <span className="t"><span className="nm">{connection.name}</span><span className="bl">{[titleOf(connection.kind), connection.account].filter(Boolean).join(' · ')}</span></span>
        <span className="lwho">{audience(connection, me)}</span>
        <ConnectionHealth connection={connection} />
        <span className="chev" aria-hidden="true">{ICONS.chev}</span>
      </a>)}
    {joined && <a className="lrow" href="/connections/tailscale">
      <span className="itemark"><Mark name="tailscale" size={32} /></span>
      <span className="t"><span className="nm">Tailscale</span><span className="bl">{[joined.tailnet, joined.address].filter(Boolean).join(' · ') || 'This server'}</span></span>
      <span className="lwho">This server</span>
      {joined.state === 'Running' ? <StatusBadge status="connected" tip="On the tailnet" /> : <StatusBadge status="failing" tip={`Tailscale is ${joined.state}`} word={joined.state} />}
      <span className="chev" aria-hidden="true">{ICONS.chev}</span>
    </a>}
  </div>
}

function CatalogItem({ item, connected }: { item: Integration; connected: boolean }) {
  const href = item.name === 'tailscale' && connected ? '/connections/tailscale' : `/connections/new/${item.name}`
  return <a className="item" href={href} title={item.blurb}>
    <span className="itemark"><Mark name={item.name} size={40} />{connected && <span className="badge" aria-label="Connected"><span>{ICONS.check}</span></span>}</span>
    <span className="t"><span className="nm">{item.title}</span><span className="bl">{item.blurb}</span></span>
  </a>
}

function audience(connection: Connection, me: Me) {
  if (connection.everyone) return 'Everyone'
  if (connection.agents) return plural(connection.agents, 'agent')
  if (connection.ownerId === me.user.id) return 'Only me'
  return `Only ${connection.ownerName}`
}
