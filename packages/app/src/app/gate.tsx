import { type ReactNode } from 'react'
import { gateOf } from '@/app/gate-state'
import { ErrorNote } from '@/components/error-note'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useCloud } from '@/features/cloud/api'
import { SignIn } from '@/features/cloud/sign-in'
import { Stage } from '@/features/cloud/step'
import { activeOf, GateContext, useChosen } from '@/features/cloud/workspaces'

type Me = { error: Error | null; isFetching: boolean; refetch: () => unknown }

export function Gate({ me, children }: { me: Me; children: ReactNode }) {
  const cloud = useCloud()
  const chosen = useChosen()
  const error = me.error ?? cloud.error
  const step = gateOf(cloud.data)
  if (step === 'loading') return error ? <Down error={error} retrying={me.isFetching} onRetry={() => { void me.refetch(); void cloud.refetch() }} /> : <Waiting />
  if (step === 'sign-in') return <Stage><SignIn cloud={cloud.data} /></Stage>
  if (!cloud.data) return <Waiting />
  const active = activeOf({ workspaces: cloud.data.workspaces, chosen })
  if (!active) return <Waiting />
  return <GateContext value={{ cloud: cloud.data, active }}>{children}</GateContext>
}

function Waiting() {
  return <div className="grid h-dvh place-items-center bg-sidebar"><span className="animate-[fadein_.3s_1s_both]"><Spinner className="size-5" /></span></div>
}

function Down({ error, retrying, onRetry }: { error: Error | null; retrying: boolean; onRetry: () => void }) {
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-sidebar px-8 text-center">
    <ErrorNote message={error instanceof DOMException ? 'OpenHut couldn’t open a secure connection to your computer.' : error?.message} />
    <Button type="button" variant="secondary" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying…' : 'Try again'}</Button>
  </div>
}
