import type { Connection } from '@fastmonkey/common/connections/connection.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import type { BrandName } from '@/components/brand-icons'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { useConnections } from '@/features/connections/api'
import { ConnectionHealth } from '@/features/connections/connection-health'
import { plural } from '@/lib/format'

const CATALOG: { shelf: string; items: { name: BrandName; title: string; blurb: string }[] }[] = [
  { shelf: 'Data', items: [
    { name: 'postgres', title: 'Postgres', blurb: 'Read-only access to a Postgres database.' },
    { name: 'convex', title: 'Convex', blurb: 'Tables, data, functions and logs from one deployment, through its deploy key.' },
    { name: 'posthog', title: 'PostHog', blurb: "Events, insights and feature flags through PostHog's own MCP, with your sign-in." },
  ] },
  { shelf: 'Work', items: [
    { name: 'linear', title: 'Linear', blurb: "Search, read and file issues through Linear's MCP, as the person who connects." },
    { name: 'gmail', title: 'Gmail', blurb: "Search, read, label and draft through Google's Gmail MCP." },
    { name: 'drive', title: 'Google Drive', blurb: "Search, read and create files through Google's Drive MCP, as the person who connects." },
    { name: 'google', title: 'Google Workspace', blurb: "Docs, Sheets, Slides and Calendar through Google's own MCP servers." },
  ] },
  { shelf: 'Network', items: [{ name: 'tailscale', title: 'Tailscale', blurb: 'Joins this server to your tailnet so Postgres can reach private hosts. Owners and admins.' }] },
  { shelf: 'Any MCP', items: [{ name: 'mcp', title: 'Custom MCP', blurb: 'Any remote MCP server: a URL plus a header or OAuth. Shared and granted like the rest.' }] },
]

export function ConnectionsPage({ me }: { me: Me }) {
  const connections = useConnections()
  const list = connections.data ?? []
  return <Page title="Connections">
    <div className="market">
      <section className="msec">
        <div className="shead"><h3>Connected <span className="count">{list.length}</span></h3></div>
        <Loaded query={connections}>{(loaded) => <ConnectedList connections={loaded} me={me} />}</Loaded>
      </section>
      {CATALOG.map((shelf) => <section className="msec" key={shelf.shelf}>
        <div className="shead"><h3>{shelf.shelf}</h3></div>
        <div className="itemgrid">{shelf.items.map((item) => <CatalogItem key={item.name} {...item} connected={list.some((connection) => connection.kind === item.name)} />)}</div>
      </section>)}
    </div>
  </Page>
}

function ConnectedList({ connections, me }: { connections: Connection[]; me: Me }) {
  if (!connections.length) return <p className="note">Nothing yet. Add Postgres below.</p>
  return <div className="lbox">{connections.map((connection) =>
    <a className={connection.usable ? 'lrow' : 'lrow dim'} href={`/connections/${connection.id}`} title={connection.usable ? 'Query, read only' : `Private to ${connection.ownerName}`} key={connection.id}>
      <span className="itemark"><Mark name={connection.kind} size={32} /></span>
      <span className="t"><span className="nm">{connection.name}</span><span className="bl">Postgres · added by {connection.ownerName}</span></span>
      <span className="lwho">{audience(connection, me)}</span>
      <ConnectionHealth connection={connection} />
      <span className="chev" aria-hidden="true">{ICONS.chev}</span>
    </a>)}</div>
}

function CatalogItem({ name, title, blurb, connected }: { name: BrandName; title: string; blurb: string; connected: boolean }) {
  const content = (line: string) => <>
    <span className="itemark"><Mark name={name} size={40} />{connected && <span className="badge" aria-label="Connected"><span>{ICONS.check}</span></span>}</span>
    <span className="t"><span className="nm">{title}</span><span className="bl">{line}</span></span>
  </>
  if (name === 'postgres') return <a className="item" href="/connections/new" title={blurb}>{content(blurb)}</a>
  return <button type="button" className="item" disabled title={blurb}>{content('Not in this build yet')}</button>
}

function audience(connection: Connection, me: Me) {
  if (connection.everyone) return 'Everyone'
  if (connection.agents) return plural(connection.agents, 'agent')
  if (connection.ownerId === me.user.id) return 'Only me'
  return `Only ${connection.ownerName}`
}
