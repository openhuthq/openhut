import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Creature } from '@/components/creature'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { useAllow, useDecline, useInvitation, useNewInvitation } from '@/features/settings/api'
import { spaced, type Invitation } from '@/features/settings/invitation'
import { open } from '@/lib/router'

type Device = NonNullable<Invitation['device']>

const SPOTS = [[-92, -14], [-56, -70], [0, -92], [56, -70], [92, -14]]

export function PairDialog({ title, waiting, check, done }: { title: string; waiting: (code: string) => ReactNode; check: (device: Device) => string; done: (device: Device) => [string, string] }) {
  const create = useNewInvitation()
  const invitation = useInvitation(create.data?.id)
  const allow = useAllow()
  const decline = useDecline()
  const { mutate } = create
  useEffect(() => mutate(), [mutate])
  const status = invitation.data?.status
  const device = invitation.data?.device
  useEffect(() => { if (status === 'declined') open() }, [status])
  const close = () => open()
  const cancel = <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
  const error = create.error?.message ?? invitation.error?.message ?? allow.error?.message ?? decline.error?.message
  const body = (children: ReactNode, foot: ReactNode, start: ReactNode = cancel) => <Dialog size="narrow" label={title} onClose={close}>
    <DialogHead title={title} onClose={close} />
    <div className="flex flex-col gap-4 px-5 py-6 text-[13px]/[18px]">{children}<ErrorNote message={error} /></div>
    <DialogFoot start={start}>{foot}</DialogFoot>
  </Dialog>

  if (device && (allow.isSuccess || status === 'accepted')) {
    const [headline, line] = done(device)
    return body(<Done headline={headline} line={line} />, <Button type="button" variant="primary" onClick={close}>Done</Button>, null)
  }
  if (device && status === 'joined') {
    const busy = allow.isPending || decline.isPending
    return body(<div className="flex flex-col items-center gap-3 py-2 text-center">
      <span className="text-[15px] font-medium">Allow "{device.name}"?</span>
      <span className="text-[44px]/[1] font-semibold tracking-[.06em] text-ink tabular-nums">{spaced(invitation.data?.digits ?? '')}</span>
      <p className="m-0 max-w-[400px] text-body">{check(device)}</p>
    </div>,
    <Button type="button" variant="primary" disabled={busy} onClick={() => allow.mutate(invitation.data?.id ?? '')}>{allow.isPending ? 'Allowing…' : 'Allow'}</Button>,
    <Button type="button" variant="secondary" disabled={busy} onClick={() => decline.mutate(invitation.data?.id ?? '', { onSuccess: close })}>Don't allow</Button>)
  }
  if (status === 'expired') return body(<div className="flex flex-col gap-1">
    <span className="text-[15px] font-medium">This code expired</span>
    <p className="m-0 text-body">A code works once, for 5 minutes.</p>
  </div>, <Button type="button" variant="primary" disabled={create.isPending} onClick={() => mutate()}>Make a new code</Button>)
  const code = create.data?.code
  return body(code ? waiting(code) : !error && <p className="m-0 flex items-center gap-2 text-mute"><Spinner className="mt-0" />Making a code…</p>, null)
}

export function Waiting({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">
    <p className="m-0 flex items-center gap-2"><Spinner className="mt-0" />{children}</p>
    <p className="m-0 pl-[22px] text-[12px]/[16px] text-mute">The code works once, for 5 minutes.</p>
  </div>
}

function Done({ headline, line }: { headline: string; line: string }) {
  return <div className="flex flex-col items-center gap-2 pb-2 text-center">
    <div className="relative mt-[100px] mb-3 grid size-[72px] place-items-center">
      <span className="absolute inset-0 scale-[2.6] rounded-full bg-[radial-gradient(circle,#f7c94840,transparent_62%)]" />
      {SPOTS.map(([x, y], index) => <span key={index} className="absolute top-3 left-1/2 -ml-[18px] [transform:translate(var(--sx),var(--sy))] animate-[outhut_.7s_var(--ease-spring)_both] [animation-delay:calc(300ms+var(--i)*140ms)]"
        style={{ '--sx': `${x}px`, '--sy': `${y}px`, '--i': index } as CSSProperties}>
        <span className="block animate-[hop_2.4s_ease-in-out_infinite] [animation-delay:calc(1100ms+var(--i)*140ms)]"><Creature id={`pair-${index}`} size={36} /></span>
      </span>)}
      <Hut className="relative size-[72px] [&>svg]:animate-hop" />
    </div>
    <span className="text-[17px]/[24px] font-semibold">{headline}</span>
    <p className="m-0 max-w-[380px] text-body">{line}</p>
  </div>
}
