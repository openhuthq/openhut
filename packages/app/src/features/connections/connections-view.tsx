import type { Connection } from '@openhut/common/connections/connection.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import type { Me } from '@openhut/common/team/team.ts'
import { useState } from 'react'
import { ArrowLeft01Icon, ArrowRight01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EmptyState } from '@/components/empty-state'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Loaded } from '@/components/loaded'
import { useAgents } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { SHELVES, integration, titleOf } from '@/features/connections/catalog'
import { ConnectSheet, useQuickConnect } from '@/features/connections/connect-sheets'
import { AgentGrants, ConnectionSheet, Faces } from '@/features/connections/manage-sheets'
import { useMe } from '@/features/people/api'
import { AppWindow, I, PILL } from '@/components/kit'
import { usePath, useSearch } from '@/lib/router'
import { cn } from '@/lib/utils'

export function ConnectionsView({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const connections = useConnections()
  const agents = useAgents()
  const quick = useQuickConnect()
  const [connectedOnly, setConnectedOnly] = useState(false)
  const [, , id = '', kind = ''] = usePath().split('/')
  const search = new URLSearchParams(useSearch())
  const list = connections.data ?? []
  const returned = id ? undefined : search.get('error') ?? undefined
  const count = list.length
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase()
  const shown = SHELVES.flatMap((each) => each.items).filter((item) => `${item.title} ${item.short}`.toLowerCase().includes(words))
  const sheet = me.data && id ? <Sheet me={me.data} id={decodeURIComponent(id)} kind={kind} connected={search.has('connected')} /> : null
  return <AppWindow label="Connections" onClose={onClose}>
    {sheet ?? <div className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pt-[22px] pb-7 phone:px-5">
      <div className="mt-[30px] flex items-center gap-3 phone:mt-0 phone:mr-12"><h2 className="m-0 text-[17px]/[24px] font-medium">{count ? 'Connections' : 'Connect apps'}</h2>
        {connections.data && (connectedOnly
          ? <Button type="button" variant="text" className="ml-auto text-[12px]" onClick={() => setConnectedOnly(false)}><I icon={ArrowLeft01Icon} size={12} />All apps</Button>
          : <Button type="button" variant="text" className="ml-auto text-[12px]" onClick={() => setConnectedOnly(true)}>{count} connected<I icon={ArrowRight01Icon} size={12} /></Button>)}
      </div>
      <ErrorNote message={returned} />
      {connectedOnly
        ? <div className="mt-6 flex flex-col gap-3"><span className="text-[12px] text-mute">Connected</span>
          <Loaded query={connections}>{(loaded) => loaded.length
            ? <ItemGroup>
              {loaded.map((connection) => <Row key={connection.id} connection={connection} agents={agents.data ?? []} />)}
            </ItemGroup>
            : <p className="m-0 text-[13px] text-balance text-body">Nothing connected yet. Pick an app under All apps.</p>}</Loaded>
        </div>
        : <div className="mt-6 flex flex-col gap-3.5"><div className="flex items-center gap-3"><span className="text-[12px] text-mute">Apps</span>
            <Input type="search" aria-label="Find an app" placeholder="Find an app" autoComplete="off" data-1p-ignore className="ml-auto h-7 w-48 text-[12.5px] phone:w-36" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          {!shown.length && <EmptyState mood="worried" line={<>No app called “{query.trim()}”. Try <a href="/connections/new/mcp" className="text-ink underline underline-offset-2">Custom MCP</a> to add any server.</>} />}
          <div className="grid grid-cols-2 gap-x-8 phone:grid-cols-1">{shown.map((item) => {
            const href = `/connections/new/${item.name}`
            return <div key={item.name} className="flex min-h-16 min-w-0 items-center gap-3">
              <span className="shrink-0"><Glyph name={item.name} size={24} /></span>
              <span className="grid min-w-0 flex-1"><span className="truncate text-[13px]/[18px] font-medium">{item.title}</span><span className="truncate text-[13px]/[18px] text-mute" title={item.blurb}>{item.short}</span></span>
              {quick.direct(item)
                ? <Button type="button" variant="secondary" className={cn(PILL, 'w-24 shrink-0 justify-center')} disabled={quick.pending} onClick={() => quick.connect(item)}>Connect</Button>
                : <a href={href} className={cn(buttonVariants({ variant: 'secondary' }), PILL, 'w-24 shrink-0 justify-center')}>Connect</a>}
            </div>
          })}</div>
        </div>}
    </div>}
  </AppWindow>
}

function Sheet({ me, id, kind, connected }: { me: Me; id: string; kind: string; connected: boolean }) {
  if (!id) return null
  if (id === 'new') {
    const item = integration(kind)
    return item ? <ConnectSheet key={item.name} me={me} item={item} /> : null
  }
  return <ConnectionSheet key={id} connectionId={id} connected={connected} />
}

function Row({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  return <Item size="sm" className="py-2.5">
    <a href={`/connections/${connection.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline">
      <Glyph name={connection.kind} size={26} />
      <ItemContent stacked><ItemTitle className="flex items-center gap-2">{connection.name}{connection.kind === 'postgres' && <Badge variant="tag">read-only</Badge>}{connection.status === 'failing' && <Badge variant="warning">failing</Badge>}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1.5 text-[13px]">{[titleOf(connection.kind), connection.account].filter(Boolean).join(' · ')}</ItemDescription></ItemContent>
    </a>
    <Faces connection={connection} agents={agents} />
    <Popover>
      <PopoverTrigger className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Can use<I icon={UnfoldMoreIcon} size={12} className="text-mute" /></PopoverTrigger>
      <PopoverContent className="w-[260px] gap-0.5 p-1.5">
        <div className="px-2 pt-1 pb-1.5 text-[12px] text-mute">Who can use {connection.name}</div>
        <AgentGrants connection={connection} agents={agents} />
      </PopoverContent>
    </Popover>
  </Item>
}

