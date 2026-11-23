import type { Computer, OpenHutAgent, OpenHutConnection } from '@/lib/openhut'
import type { Me } from '@openhut/common/team/team.ts'
import { useState } from 'react'
import { ArrowRight01Icon, Search01Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Loaded } from '@/components/loaded'
import { useAgents } from '@/features/agents/api'
import { nameOf, useComputers } from '@/features/computers/api'
import { ChangedBy, useChangedByOther } from '@/features/cloud/live'
import { useConnections } from '@/features/connections/api'
import { SHELVES, integration, titleOf } from '@/features/connections/catalog'
import { ConnectSheet, useQuickConnect } from '@/features/connections/connect-sheets'
import { AgentGrants, ConnectionSheet, Faces } from '@/features/connections/manage-sheets'
import { useMe } from '@/features/people/api'
import { AppWindow, I, PILL } from '@/components/kit'
import { usePath, useSearch } from '@/lib/router'
import { cn } from '@/lib/utils'

const CONNECTED = 'Connected'

export function ConnectionsView({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const connections = useConnections()
  const agents = useAgents()
  const computers = useComputers()
  const quick = useQuickConnect()
  const many = (computers.data?.length ?? 0) > 1
  const [shelf, setShelf] = useState('All')
  const [query, setQuery] = useState('')
  const [, , id = '', kind = ''] = usePath().split('/')
  const search = new URLSearchParams(useSearch())
  const list = connections.data ?? []
  const returned = id ? undefined : search.get('error') ?? undefined
  const count = list.length
  const words = query.trim().toLowerCase()
  const shown = SHELVES.filter((each) => shelf === 'All' || each.shelf === shelf).flatMap((each) => each.items)
    .filter((item) => !words || `${item.title} ${item.short}`.toLowerCase().includes(words))
  const sheet = me.data && id ? <Sheet me={me.data} id={decodeURIComponent(id)} kind={kind} connected={search.has('connected')} /> : null
  return <AppWindow label="Connections" onClose={onClose}>
    {sheet ?? <div className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pt-[22px] pb-7 phone:px-5">
      <div className="mt-[30px] flex items-center gap-3 phone:mt-0 phone:mr-12"><h2 className="m-0 text-[17px]/[24px] font-medium">{count ? 'Connections' : 'Connect apps'}</h2>
        {connections.data && <Button type="button" variant="text" className="ml-auto text-[12px]" onClick={() => setShelf(CONNECTED)}>{count} connected<I icon={ArrowRight01Icon} size={12} /></Button>}
      </div>
      <label className="mt-4 flex h-9 items-center gap-2 text-mute"><I icon={Search01Icon} size={16} /><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" aria-label="Search apps" className="h-9 border-0 bg-transparent px-0 text-[13px] [-webkit-appearance:none]" /></label>
      <ToggleGroup variant="pill" aria-label="Category" className="mt-2 flex flex-wrap gap-2" value={shelf} onPick={setShelf}>
        {['All', ...SHELVES.filter((each) => each.items.length > 1).map((each) => each.shelf)].map((name) => <ToggleGroupItem key={name} value={name} className="h-7 border-0 bg-soft px-2.5 text-[13px] font-normal text-ink">{name}</ToggleGroupItem>)}
      </ToggleGroup>
      <ErrorNote message={returned} />
      {shelf === CONNECTED
        ? <div className="mt-6 flex flex-col gap-3"><span className="text-[12px] text-mute">Connected</span>
          <Loaded query={connections}>{(loaded) => loaded.length
            ? <ItemGroup>
              {loaded.map((connection) => <Row key={connection.id} connection={connection} agents={agents.data ?? []} computers={many ? computers.data : undefined} />)}
            </ItemGroup>
            : <p className="m-0 text-[13px] text-balance text-body">Nothing connected yet. Pick an app under All.</p>}</Loaded>
        </div>
        : <div className="mt-6 flex flex-col gap-3.5"><span className="text-[12px] text-mute">{shelf === 'All' ? 'Apps' : shelf}</span>
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
          {!shown.length && <p className="m-0 text-[14px] text-body">Nothing matches “{query}”.</p>}
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

function Row({ connection, agents, computers }: { connection: OpenHutConnection; agents: OpenHutAgent[]; computers: Computer[] | undefined }) {
  const changedByOther = useChangedByOther(connection.changedBy)
  return <Item size="sm" className={cn('py-2.5', !connection.usable && 'opacity-60')}>
    <a href={`/connections/${connection.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline">
      <Glyph name={connection.kind} size={26} />
      <ItemContent stacked><ItemTitle className="flex items-center gap-2">{connection.name}{connection.kind === 'postgres' && <Badge variant="tag">read-only</Badge>}{connection.status === 'failing' && <Badge variant="warning">failing</Badge>}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1.5 text-[13px]">{[titleOf(connection.kind), connection.account, !connection.keyHere && 'Key on an admin’s computer'].filter(Boolean).join(' · ')}{connection.changedBy && changedByOther && <><span aria-hidden>·</span><ChangedBy email={connection.changedBy} /></>}</ItemDescription></ItemContent>
      {computers && <span className="flex shrink-0 flex-wrap gap-1">{connection.computers.map((copy) => <span key={copy.computer} title={copy.online ? undefined : 'Offline'}
        className={cn('inline-flex h-5 items-center gap-1 rounded-md bg-soft px-1.5 text-[11.5px]', copy.online ? 'text-ink' : 'text-mute-2')}><i className={cn('size-1.5 rounded-full', copy.online ? 'bg-pass' : 'bg-mute-2')} />{nameOf({ computers, id: copy.computer })}</span>)}</span>}
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

