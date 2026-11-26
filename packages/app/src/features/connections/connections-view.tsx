import type { Connection } from '@openhut/common/connections/connection.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import { useState } from 'react'
import { UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EmptyState } from '@/components/empty-state'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Loaded } from '@/components/loaded'
import { useAgents } from '@/features/agents/api'
import { useConnections } from '@/features/connections/api'
import { appRows, appStatus, byName, connectionBrand, INTEGRATIONS, integration, kindNote, type Integration } from '@/features/connections/catalog'
import { ConnectSheet, useQuickConnect } from '@/features/connections/connect-sheets'
import { AgentGrants, ConnectionSheet, Faces } from '@/features/connections/manage-sheets'
import { useMe } from '@/features/people/api'
import { Chevron, Row, Rows } from '@/features/settings/kit'
import { I, PILL } from '@/components/kit'
import { StatusBadge } from '@/components/status-badge'
import { usePath, useSearch } from '@/lib/router'
import { cn } from '@/lib/utils'

export function AppsSheet() {
  const me = useMe()
  const [, , id = '', kind = ''] = usePath().split('/')
  const connected = new URLSearchParams(useSearch()).has('connected')
  if (!me.data || !id) return null
  if (id === 'new') {
    const item = integration(kind)
    return item ? <ConnectSheet key={item.name} me={me.data} item={item} /> : null
  }
  return <ConnectionSheet key={id} connectionId={decodeURIComponent(id)} connected={connected} />
}

export function AppsSettings() {
  const connections = useConnections()
  const agents = useAgents()
  const quick = useQuickConnect()
  const [view, setView] = useState<'all' | 'connected'>('all')
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase()
  const returned = new URLSearchParams(useSearch()).get('error') ?? undefined
  const list = connections.data ?? []
  const shown = appRows({ items: INTEGRATIONS, connections: list }).filter((row) => `${row.title} ${row.note}`.toLowerCase().includes(words))
  return <div className="flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <ToggleGroup aria-label="Apps" value={view} onPick={(next) => setView(next === 'connected' ? 'connected' : 'all')}>
        <ToggleGroupItem value="all">All apps</ToggleGroupItem>
        <ToggleGroupItem value="connected">Connected ({list.length})</ToggleGroupItem>
      </ToggleGroup>
      {view === 'all' && <Input type="search" aria-label="Find an app" placeholder="Find an app" autoComplete="off" data-1p-ignore className="ml-auto h-7 w-48 text-[12.5px] phone:w-36" value={query} onChange={(event) => setQuery(event.target.value)} />}
    </div>
    <ErrorNote message={returned} />
    {view === 'connected'
      ? <Loaded query={connections}>{(loaded) => loaded.length
        ? <Rows>{byName(loaded, (connection) => connection.name).map((connection) => <ConnectedRow key={connection.id} connection={connection} agents={agents.data ?? []} />)}</Rows>
        : <EmptyState line="No apps connected yet. Pick one under All apps so your agents can read your mail, files or code." />}</Loaded>
      : <>{!shown.length && <EmptyState mood="worried" line={<>No app called “{query.trim()}”. Try <a href="/connections/new/mcp" className="text-ink underline underline-offset-2">Custom MCP</a> to add any server.</>} />}<Rows>{shown.map((row) => <Row key={row.key} icon={<Glyph name={row.brand} size={20} />} title={row.title} note={row.note}>
        <AppAction status={appStatus(row.connections)} item={row.item} href={row.item ? undefined : `/connections/${row.connections[0]?.id}`} quick={quick} />
      </Row>)}</Rows></>}
  </div>
}

function AppAction({ status, item, href, quick }: { status: ReturnType<typeof appStatus>; item: Integration | undefined; href: string | undefined; quick: ReturnType<typeof useQuickConnect> }) {
  if (status) return href ? <a href={href} className="no-underline"><StatusBadge status={status} /></a> : <StatusBadge status={status} />
  if (!item) return null
  if (quick.direct(item)) return <Button type="button" variant="ghost" className={PILL} disabled={quick.pending} onClick={() => quick.connect(item)}>Connect</Button>
  return <a href={`/connections/new/${item.name}`} className={cn(buttonVariants({ variant: 'ghost' }), PILL)}>Connect</a>
}

function ConnectedRow({ connection, agents }: { connection: Connection; agents: OpenHutAgent[] }) {
  return <Row icon={<Glyph name={connectionBrand(connection)} size={20} />} title={<span className="flex items-center gap-2">{connection.name}{connection.kind === 'postgres' && <Badge variant="tag">read-only</Badge>}<StatusBadge status={connection.status} /></span>} note={kindNote(connection)}>
    <Faces connection={connection} agents={agents} />
    <Popover>
      <PopoverTrigger className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Can use<I icon={UnfoldMoreIcon} size={12} className="text-mute" /></PopoverTrigger>
      <PopoverContent className="w-[260px] gap-0.5 p-1.5">
        <div className="px-2 pt-1 pb-1.5 text-[12px] text-mute">Who can use {connection.name}</div>
        <AgentGrants connection={connection} agents={agents} />
      </PopoverContent>
    </Popover>
    <a href={`/connections/${connection.id}`} aria-label={`Manage ${connection.name}`} title="Manage" className="grid size-7 place-items-center rounded-md hover:bg-hover"><Chevron /></a>
  </Row>
}
