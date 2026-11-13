import type { Me } from '@fastmonkey/common/team/team.ts'
import { ConfirmButton } from '@/components/confirm-button'
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

const PARENTS = [{ label: 'Connections', href: '/connections' }]

export function TailscalePage({ me }: { me: Me }) {
  const tailscale = useTailscale()
  const disconnect = useDisconnectTailscale()
  const joined = tailscale.data?.connected
  if (!joined) return <Page title="Tailscale" parents={PARENTS}>
    <ErrorNote message={tailscale.error?.message} />
    {tailscale.data && <div className="empty"><Mark name="tailscale" size={56} /><div>This server isn't on a tailnet.</div><a className="btn primary" href="/connections/new/tailscale">Connect Tailscale</a></div>}
  </Page>
  const admin = me.user.role !== 'member'
  const detail = joined.joined ? 'This server logs out of the tailnet. Connections to tailnet hosts stop working.' : 'Fast Monkey forgets it. The server was on this tailnet before, so it stays on it.'
  const actions = <Locked reason={admin ? undefined : 'Only an owner or admin can disconnect it'}>
    <ConfirmButton className="btn danger" disabled={!admin || disconnect.isPending} question="Disconnect Tailscale?" detail={detail} action="Disconnect" onConfirm={() => disconnect.mutate(undefined, { onError: toastError })}>
      {ICONS.trash}<span className="lbl">Disconnect</span>
    </ConfirmButton>
  </Locked>
  return <Page title="Tailscale" parents={PARENTS} actions={actions}>
    <div className="detail wide">
      <div className="left">
        <section>
          <SectionHead title="What it does" />
          <ul className="clist box pad">{integration('tailscale')?.gets.map((line) => <li key={line}>{ICONS.check}<span>{line}</span></li>)}</ul>
        </section>
        {!joined.joined && <p className="note">This server was already on a tailnet when it was connected, so Fast Monkey left Tailscale as it was.</p>}
      </div>
      <aside className="rail">
        <div className="box facts">
          <div><span>Status</span>{joined.state === 'Running' ? <StatusBadge status="connected" tip="On the tailnet" /> : <StatusBadge status="failing" tip={`Tailscale is ${joined.state}`} word={joined.state} />}</div>
          <div><span>Tailnet</span><span className="ellip">{joined.tailnet || '—'}</span></div>
          <div><span>Name</span><span className="mono ellip">{joined.name || '—'}</span></div>
          <div><span>Address</span><span className="mono">{joined.address || '—'}</span></div>
          <div><span>Connected by</span><span className="ellip">{joined.by}</span></div>
          <div><span>Since</span><span>{shortDate.format(new Date(joined.at))}</span></div>
        </div>
      </aside>
    </div>
  </Page>
}
