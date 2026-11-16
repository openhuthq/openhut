import type { Me } from '@openhut/common/team/team.ts'
import { buttonVariants } from '@/components/ui/button'
import { cardVariants } from '@/components/ui/card'
import { Empty } from '@/components/ui/empty'
import { ConfirmButton } from '@/components/confirm-button'
import { Fact, Facts } from '@/components/facts'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { SectionHead } from '@/components/section-head'
import { StatusBadge } from '@/components/status-badge'
import { useDisconnectTailscale, useTailscale } from '@/features/connections/api'
import { integration } from '@/features/connections/catalog'
import { shortDate } from '@/lib/format'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const PARENTS = [{ label: 'Connections', href: '/connections' }]

export function TailscalePage({ me }: { me: Me }) {
  const tailscale = useTailscale()
  const disconnect = useDisconnectTailscale()
  const joined = tailscale.data?.connected
  if (!joined) return <Page title="Tailscale" parents={PARENTS}>
    <ErrorNote message={tailscale.error?.message} />
    {tailscale.data && <Empty><Mark name="tailscale" size={56} /><div>This server isn't on a tailnet.</div><a className={buttonVariants({ variant: 'primary' })} href="/connections/new/tailscale">Connect Tailscale</a></Empty>}
  </Page>
  const admin = me.user.role !== 'member'
  const detail = joined.joined ? 'This server logs out of the tailnet. Connections to tailnet hosts stop working.' : 'Only the record here is removed. The server was on this tailnet before, so it stays on it.'
  const actions = <Locked reason={admin ? undefined : 'Only an owner or admin can disconnect it'}>
    <ConfirmButton disabled={!admin || disconnect.isPending} question="Disconnect Tailscale?" detail={detail} action="Disconnect" onConfirm={() => disconnect.mutate(undefined, { onError: toastError })}>
      Disconnect
    </ConfirmButton>
  </Locked>
  return <Page title="Tailscale" parents={PARENTS} actions={actions}>
    <div className="mx-auto grid w-full max-w-[1152px] grid-cols-[minmax(0,1fr)_380px] gap-6 mobile:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-6">
        <section>
          <SectionHead title="What it does" />
          <ul className={cn(cardVariants(), 'm-0 flex list-none flex-col gap-[9px] p-4 text-sm/[1.45] [&_li]:flex [&_li]:items-start [&_li]:gap-2.5 [&_svg]:mt-1 [&_svg]:size-2.5 [&_svg]:shrink-0 [&_svg]:text-pass')}>{integration('tailscale')?.gets.map((line) => <li key={line}>{ICONS.check}<span>{line}</span></li>)}</ul>
        </section>
        {!joined.joined && <p className="m-0 text-mute">This server was already on a tailnet when it was connected, so Tailscale was left as it was.</p>}
      </div>
      <aside className="flex min-w-0 flex-col gap-6 mobile:-order-1">
        <Facts>
          <Fact label="Status">{joined.state === 'Running' ? <StatusBadge status="connected" tip="On the tailnet" /> : <StatusBadge status="failing" tip={`Tailscale is ${joined.state}`} word={joined.state} />}</Fact>
          <Fact label="Tailnet"><span className="truncate">{joined.tailnet || '—'}</span></Fact>
          <Fact label="Name"><span className="truncate font-mono text-xs">{joined.name || '—'}</span></Fact>
          <Fact label="Address"><span className="font-mono text-xs">{joined.address || '—'}</span></Fact>
          <Fact label="Connected by"><span className="truncate">{joined.by}</span></Fact>
          <Fact label="Since"><span>{shortDate.format(new Date(joined.at))}</span></Fact>
        </Facts>
      </aside>
    </div>
  </Page>
}
