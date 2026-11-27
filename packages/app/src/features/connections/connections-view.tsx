import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { useConnections } from '@/lib/queries/connections'
import { appRows, INTEGRATIONS, integration, type Integration } from '@/config/catalog'
import { ConnectSheet, useQuickConnect } from '@/features/connections/connect-sheets'
import { ConnectionSheet } from '@/features/connections/manage-sheets'
import { useMe } from '@/lib/queries/people'
import { PILL, Row, Rows } from '@/components/kit'
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
  const quick = useQuickConnect()
  const returned = new URLSearchParams(useSearch()).get('error') ?? undefined
  return <div className="flex flex-col gap-4">
    <ErrorNote message={returned} />
    <Rows>{appRows({ items: INTEGRATIONS, connections: connections.data ?? [] }).map((row) => <Row key={row.key} icon={<Glyph name={row.brand} size={20} />} title={row.title} note={row.note} href={row.href}>
      {row.connection ? <StatusBadge status={row.connection.status} /> : row.item && <ConnectAction item={row.item} quick={quick} />}
    </Row>)}</Rows>
  </div>
}

function ConnectAction({ item, quick }: { item: Integration; quick: ReturnType<typeof useQuickConnect> }) {
  if (quick.direct(item)) return <Button type="button" variant="ghost" className={PILL} disabled={quick.pending} onClick={() => quick.connect(item)}>Connect</Button>
  return <a href={`/connections/new/${item.name}`} className={cn(buttonVariants({ variant: 'ghost' }), PILL)}>Connect</a>
}
