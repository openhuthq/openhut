import { type ReactNode } from 'react'
import { ErrorNote } from '@/components/error-note'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type Me = { data: unknown; error: Error | null; isFetching: boolean; refetch: () => unknown }

export function Gate({ me, children }: { me: Me; children: ReactNode }) {
  if (me.data) return children
  if (me.error) return <Down error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />
  return <Waiting />
}

function Waiting() {
  return <div className="grid h-dvh place-items-center bg-sidebar"><span className="animate-[fadein_.3s_1s_both]"><Spinner className="size-5" /></span></div>
}

function Down({ error, retrying, onRetry }: { error: Error; retrying: boolean; onRetry: () => void }) {
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-sidebar px-8 text-center">
    <ErrorNote message={error.message} />
    <Button type="button" variant="secondary" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying…' : 'Try again'}</Button>
  </div>
}
