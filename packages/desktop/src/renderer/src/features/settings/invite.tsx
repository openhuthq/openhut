import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { useAllow, useDecline, useInvitation, useNewInvitation } from '@/features/settings/api'
import { spaced, type Invitation } from '@/features/settings/invitation'
import { open } from '@/lib/router'

type Device = NonNullable<Invitation['device']>

export function PairDialog({ title, waiting, check }: { title: string; waiting: (code: string) => ReactNode; check: (device: Device) => string }) {
  const create = useNewInvitation()
  const invitation = useInvitation(create.data?.id)
  const allow = useAllow()
  const decline = useDecline()
  const { mutate } = create
  useEffect(() => mutate(), [mutate])
  const status = invitation.data?.status
  const device = invitation.data?.device
  useEffect(() => { if (status === 'declined' || status === 'accepted') open() }, [status])
  const close = () => open()
  const cancel = <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
  const error = create.error?.message ?? invitation.error?.message ?? allow.error?.message ?? decline.error?.message
  const body = (children: ReactNode, foot: ReactNode, start: ReactNode = cancel) => <Dialog size="narrow" label={title} onClose={close}>
    <DialogHead title={title} onClose={close} />
    <div className="flex flex-col gap-4 px-5 py-6 text-[13px]/[18px]">{children}<ErrorNote message={error} /></div>
    <DialogFoot start={start}>{foot}</DialogFoot>
  </Dialog>

  if (device && status === 'joined') {
    const busy = allow.isPending || decline.isPending
    return body(<div className="flex flex-col items-center gap-3 py-2 text-center">
      <span className="text-[15px] font-medium">Allow "{device.name}"?</span>
      <span className="text-[44px]/[1] font-semibold tracking-[.06em] text-ink tabular-nums">{spaced(invitation.data?.digits ?? '')}</span>
      <p className="m-0 max-w-[400px] text-body">{check(device)}</p>
    </div>,
    <Button type="button" variant="primary" disabled={busy} onClick={() => allow.mutate(invitation.data?.id ?? '', { onSuccess: close })}>{allow.isPending ? 'Allowing…' : 'Allow'}</Button>,
    <Button type="button" variant="secondary" disabled={busy} onClick={() => decline.mutate(invitation.data?.id ?? '', { onSuccess: close })}>Don't allow</Button>)
  }
  if (status === 'expired') return body(<div className="flex flex-col gap-1">
    <span className="text-[15px] font-medium">This code expired</span>
    <p className="m-0 text-body">A code works once, for 5 minutes.</p>
  </div>, <Button type="button" variant="primary" disabled={create.isPending} onClick={() => mutate()}>Make a new code</Button>)
  const code = create.data?.code
  return body(code ? waiting(code) : !error && <p className="m-0 flex items-center gap-2 text-mute"><Spinner className="mt-0" />Making a code…</p>, null)
}

export function Waiting({ children, note = 'The code works once, for 5 minutes.' }: { children: ReactNode; note?: string }) {
  return <div className="flex flex-col gap-1">
    <p className="m-0 flex items-center gap-2"><Spinner className="mt-0" />{children}</p>
    <p className="m-0 pl-[22px] text-[12px]/[16px] text-mute">{note}</p>
  </div>
}
