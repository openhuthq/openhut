import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { PILL } from '@/components/kit'
import { useAllow, useDecline, useInvitation, useNewInvitation } from '@/features/settings/api'
import { spaced, type Invitation } from '@/features/settings/invitation'
import { open } from '@/lib/router'

const LINE = 'm-0 max-w-[420px] text-[13px] text-body'

export function Invite({ waiting, check }: { waiting: (code: string) => ReactNode; check: (device: NonNullable<Invitation['device']>) => string }) {
  const create = useNewInvitation()
  const invitation = useInvitation(create.data?.id)
  const status = invitation.data?.status
  const { mutate } = create
  useEffect(() => mutate(), [mutate])
  useEffect(() => { if (status === 'accepted' || status === 'declined') open() }, [status])
  const error = create.error?.message ?? invitation.error?.message
  if (status === 'expired') return <div className="flex flex-col items-start gap-3 px-2.5">
    <span className="text-[14px] font-medium">This code expired</span>
    <p className={LINE}>A code works once, for 5 minutes.</p>
    <Button type="button" variant="secondary" className={PILL} disabled={create.isPending} onClick={() => mutate()}>Make a new code</Button>
  </div>
  if (status === 'joined' && invitation.data?.device) return <Allow id={invitation.data.id} name={invitation.data.device.name} digits={invitation.data.digits ?? ''} line={check(invitation.data.device)} />
  return <>
    {create.data?.code && !error ? waiting(create.data.code) : !error && <p className="m-0 flex items-center gap-2 px-2.5 text-[13px] text-mute"><Spinner className="mt-0" />Making a code…</p>}
    <ErrorNote message={error} className="mx-2.5" />
  </>
}

function Allow({ id, name, digits, line }: { id: string; name: string; digits: string; line: string }) {
  const allow = useAllow()
  const decline = useDecline()
  const busy = allow.isPending || allow.isSuccess
  return <div className="flex flex-col items-start gap-3 px-2.5">
    <span className="text-[14px] font-medium">Allow "{name}"?</span>
    <span className="text-[30px]/[1] font-semibold tracking-[.06em] text-ink tabular-nums">{spaced(digits)}</span>
    <p className={LINE}>{line}</p>
    <ErrorNote message={allow.error?.message ?? decline.error?.message} />
    <div className="flex gap-2 pt-1">
      <Button type="button" variant="secondary" className={PILL} disabled={busy || decline.isPending} onClick={() => decline.mutate(id, { onSuccess: () => open() })}>Don't allow</Button>
      <Button type="button" variant="primary" className={PILL} disabled={busy || decline.isPending} onClick={() => allow.mutate(id)}>{busy ? 'Allowing…' : 'Allow'}</Button>
    </div>
  </div>
}
