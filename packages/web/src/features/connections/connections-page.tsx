import type { ReactNode } from 'react'
import type { Connection, Tailscale } from '@openhut/common/connections/connection.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { ItemContent, ItemDescription, ItemGroup, ItemTitle, itemVariants } from '@/components/ui/item'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { SectionHead } from '@/components/section-head'
import { StatusBadge } from '@/components/status-badge'
import { useConnections, useTailscale } from '@/features/connections/api'
import { SHELVES, integration, titleOf, type Integration } from '@/features/connections/catalog'
import { ConnectDialog } from '@/features/connections/connect-dialog'
import { ConnectionHealth } from '@/features/connections/connection-health'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

const ROW = itemVariants({ size: 'lg', interactive: true })
const WHO = 'whitespace-nowrap text-mute phone:hidden'

export function ConnectionsPage({ me, adding }: { me: Me; adding: string | undefined }) {
  const connections = useConnections()
  const tailscale = useTailscale()
  const list = connections.data ?? []
  const joined = tailscale.data?.connected
  const item = adding ? integration(adding) : undefined
  const returned = adding ? undefined : new URLSearchParams(location.search).get('error') ?? undefined
  return <Page title="Connections">
    <div className="mx-auto flex max-w-[800px] flex-col gap-8 pt-2">
      <ErrorNote message={returned} />
      <section className="flex flex-col gap-2.5">
        <SectionHead title="Connected" count={list.length + (joined ? 1 : 0)} />
        <Loaded query={connections}>{(loaded) => <ConnectedList connections={loaded} tailscale={tailscale.data} me={me} />}</Loaded>
      </section>
      {SHELVES.map((shelf) => <section className="flex flex-col gap-2.5" key={shelf.shelf}>
        <SectionHead title={shelf.shelf} />
        <div className="grid grid-cols-2 gap-x-12 gap-y-4 narrow:grid-cols-1 narrow:gap-1">{shelf.items.map((each) => <CatalogItem key={each.name} item={each}
          connected={each.name === 'tailscale' ? !!joined : list.some((connection) => connection.kind === each.name)} />)}</div>
      </section>)}
    </div>
    {item && <ConnectDialog key={item.name} me={me} item={item} />}
  </Page>
}

function ConnectedList({ connections, tailscale, me }: { connections: Connection[]; tailscale: Tailscale | undefined; me: Me }) {
  const joined = tailscale?.connected
  if (!connections.length && !joined) return <p className="m-0 text-mute">Nothing yet. Pick one below: each opens a short guide.</p>
  return <ItemGroup variant="ring">
    {connections.map((connection) =>
      <a className={cn(ROW, !connection.usable && 'opacity-55')} href={`/connections/${connection.id}`} title={connection.usable ? undefined : `Private to ${connection.ownerName}`} key={connection.id}>
        <MarkBox><Mark name={connection.kind} size={32} variant="outline" /></MarkBox>
        <ItemContent stacked><ItemTitle>{connection.name}</ItemTitle><ItemDescription>{[titleOf(connection.kind), connection.account].filter(Boolean).join(' · ')}</ItemDescription></ItemContent>
        <span className={WHO}>{audience(connection, me)}</span>
        <ConnectionHealth connection={connection} />
        <span className="grid text-mute" aria-hidden="true">{ICONS.chev}</span>
      </a>)}
    {joined && <a className={ROW} href="/connections/tailscale">
      <MarkBox><Mark name="tailscale" size={32} variant="outline" /></MarkBox>
      <ItemContent stacked><ItemTitle>Tailscale</ItemTitle><ItemDescription>{[joined.tailnet, joined.address].filter(Boolean).join(' · ') || 'This server'}</ItemDescription></ItemContent>
      <span className={WHO}>This server</span>
      {joined.state === 'Running' ? <StatusBadge status="connected" tip="On the tailnet" /> : <StatusBadge status="failing" tip={`Tailscale is ${joined.state}`} word={joined.state} />}
      <span className="grid text-mute" aria-hidden="true">{ICONS.chev}</span>
    </a>}
  </ItemGroup>
}

function CatalogItem({ item, connected }: { item: Integration; connected: boolean }) {
  const href = item.name === 'tailscale' && connected ? '/connections/tailscale' : `/connections/new/${item.name}`
  return <a className={itemVariants({ size: 'catalog' })} href={href} title={item.blurb}>
    <MarkBox><Mark name={item.name} size={40} />{connected && <span className="absolute -right-[5px] -bottom-[5px] grid size-[17px] place-items-center rounded-full bg-canvas" aria-label="Connected"><span className="grid size-[13px] place-items-center rounded-full bg-ink text-canvas [&_svg]:size-[9px]">{ICONS.check}</span></span>}</MarkBox>
    <ItemContent stacked><ItemTitle size="catalog">{item.title}</ItemTitle><ItemDescription size="catalog">{item.blurb}</ItemDescription></ItemContent>
  </a>
}

function MarkBox({ children }: { children: ReactNode }) {
  return <span className="relative block size-10 shrink-0">{children}</span>
}

function audience(connection: Connection, me: Me) {
  if (connection.everyone) return 'Everyone'
  if (connection.agents) return plural(connection.agents, 'agent')
  if (connection.ownerId === me.user.id) return 'Only me'
  return `Only ${connection.ownerName}`
}
