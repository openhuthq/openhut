import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { gateOf } from '@/app/gate-state'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { DRAG, I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { notifyUnlock, useCloud } from '@/features/cloud/api'
import { SaveKit, SignIn } from '@/features/cloud/sign-in'
import { Window } from '@/features/cloud/step'
import { Unlock } from '@/features/cloud/unlock'
import { activeOf, GateContext, useChosen } from '@/features/cloud/workspaces'
import { JoinLinkDialog } from '@/features/join/cloud-join'
import { useFirstRun, type FirstRun } from '@/features/settings/desktop'
import { Progress } from '@/features/settings/kit'
import { isPhone, UnlockCanceled } from '@/lib/native'
import { useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

type Me = { error: Error | null; isFetching: boolean; refetch: () => unknown }

export function Gate({ me, children }: { me: Me; children: ReactNode }) {
  const cloud = useCloud()
  const run = useFirstRun()
  const queries = useQueryClient()
  const chosen = useChosen()
  const opened = useOpen()
  const [saving, setSaving] = useState(false)
  const step = gateOf({ cloud: cloud.data, setup: run.data, down: Boolean(me.error ?? cloud.error) })
  const done = run.data?.done
  useEffect(() => {
    if (done) void queries.invalidateQueries()
  }, [done, queries])
  useEffect(() => {
    if (step === 'unlock') void notifyUnlock()
  }, [step])
  if (step === 'loading') return me.error ?? cloud.error ? <Down error={me.error ?? cloud.error} retrying={me.isFetching} onRetry={() => { void me.refetch(); void cloud.refetch() }} /> : <Waiting />
  if (isPhone() && step !== 'ready') return <Window><Hut mood="key" className="size-[84px]" /><p className="m-0 max-w-[300px] text-[15px]/[1.5] text-body">Finish setting up OpenHut on your computer, then come back.</p></Window>
  if (step === 'kit' && !saving) setSaving(true)
  if (saving) return <Card><SaveKit onDone={() => setSaving(false)} /></Card>
  if (step === 'getting-ready') return <GettingReady run={run.data} onRetry={() => void run.refetch()} />
  if (step === 'sign-in') return <><SignIn cloud={cloud.data} />{opened === 'join-link' && <JoinLinkDialog />}</>
  if (!cloud.data) return <Waiting />
  if (step === 'unlock') return <Card><Unlock cloud={cloud.data} /></Card>
  const active = activeOf({ workspaces: cloud.data.workspaces, chosen })
  if (!active) return <Waiting />
  return <GateContext value={{ cloud: cloud.data, active }}>{children}</GateContext>
}

function Card({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>{document.title}</div>
    <div className="flex flex-1 items-center justify-center px-6 pb-12">
      <div className="flex h-[min(560px,100%)] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-hair bg-card">{children}</div>
    </div>
  </div>
}

function Waiting() {
  return <div className="grid h-dvh place-items-center bg-sidebar"><span className="animate-[fadein_.3s_1s_both]"><Spinner className="size-5" /></span></div>
}

function Down({ error, retrying, onRetry }: { error: Error | null; retrying: boolean; onRetry: () => void }) {
  const canceled = error instanceof UnlockCanceled
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-sidebar px-8 text-center">
    {canceled ? <p className="m-0 max-w-[280px] text-[15px] text-body">{error.message}</p> : <ErrorNote message={error instanceof DOMException ? 'OpenHut couldn’t open a secure connection to your computer.' : error?.message} />}
    <Button type="button" variant="secondary" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying…' : canceled ? 'Unlock' : 'Try again'}</Button>
  </div>
}

function GettingReady({ run, onRetry }: { run: FirstRun | undefined; onRetry: () => void }) {
  return <Window>
    <Hut className={cn('size-20', !run?.failed && '[&>svg]:animate-[hop_1.6s_ease-in-out_infinite]')} />
    <h1 className="m-0 text-[20px]/[1.3] font-semibold">Getting OpenHut ready</h1>
    <div className="mt-2 w-[480px] max-w-full rounded-lg border border-hair bg-card p-4 text-left"><Progress rows={run?.steps ?? []} /></div>
    {run?.failed
      ? <Button variant="secondary" className="gap-2" onClick={onRetry}><I icon={Refresh01Icon} size={14} />Try again</Button>
      : <span className="inline-flex items-center gap-1.5 text-[12px] text-mute"><I icon={Clock01Icon} size={13} />Only the first time. After this it starts in about ten seconds.</span>}
  </Window>
}
