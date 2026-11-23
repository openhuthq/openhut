import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { gateOf } from '@/app/gate-state'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Meter } from '@/components/ui/meter'
import { Spinner } from '@/components/ui/spinner'
import { notifyUnlock, useCloud, usePasskeys } from '@/features/cloud/api'
import { SaveKit, SignIn, TouchIdOffer } from '@/features/cloud/sign-in'
import { BIG, Stage, Step } from '@/features/cloud/step'
import { Unlock } from '@/features/cloud/unlock'
import { activeOf, GateContext, useChosen } from '@/features/cloud/workspaces'
import { JoinLinkDialog } from '@/features/join/cloud-join'
import { useFirstRun, type FirstRun } from '@/features/settings/desktop'
import { isPhone, UnlockCanceled } from '@/lib/native'
import { RequestError } from '@/lib/api-client'
import { useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

type Me = { error: Error | null; isFetching: boolean; refetch: () => unknown }

const INSTALL_POLL_MS = 3000

export function Gate({ me, children }: { me: Me; children: ReactNode }) {
  const cloud = useCloud()
  const run = useFirstRun()
  const queries = useQueryClient()
  const chosen = useChosen()
  const opened = useOpen()
  const [saving, setSaving] = useState(false)
  const [offer, setOffer] = useState(false)
  const helper = usePasskeys()
  const [readying, setReadying] = useState(false)
  const error = me.error ?? cloud.error
  const installing = error instanceof RequestError && error.status === 503
  const { refetch: refetchMe } = me
  const { refetch: refetchCloud } = cloud
  const step = gateOf({ cloud: cloud.data, setup: run.data, down: Boolean(error) })
  const done = run.data?.done
  useEffect(() => {
    if (done) void queries.invalidateQueries()
  }, [done, queries])
  useEffect(() => {
    if (step === 'unlock') void notifyUnlock()
  }, [step])
  useEffect(() => {
    if (!installing) return
    const timer = setInterval(() => { void refetchMe(); void refetchCloud() }, INSTALL_POLL_MS)
    return () => clearInterval(timer)
  }, [installing, refetchMe, refetchCloud])
  if (step === 'loading') return error && !installing ? <Down error={error} retrying={me.isFetching} onRetry={() => { void me.refetch(); void cloud.refetch() }} /> : <Waiting note={installing ? 'Setting up OpenHut on this computer. The first time takes a few minutes.' : undefined} />
  if (isPhone() && step !== 'ready') return <Stage><Step title="Finish on your computer." line="Set up OpenHut there, then come back." /></Stage>
  if (step === 'kit' && !saving) setSaving(true)
  if (saving) return <Stage><SaveKit onDone={() => {
    setSaving(false)
    setOffer(Boolean(helper?.passkeys && helper.prf && !cloud.data?.passkey))
  }} /></Stage>
  if (offer) return <Stage><TouchIdOffer onDone={() => setOffer(false)} /></Stage>
  if (step === 'getting-ready' && !readying) setReadying(true)
  if (readying && step !== 'getting-ready' && step !== 'ready') setReadying(false)
  if (step === 'getting-ready' || (readying && step === 'ready')) return <Stage><GettingReady run={run.data} ready={step === 'ready'} onRetry={() => void run.refetch()} onOpen={() => setReadying(false)} /></Stage>
  if (step === 'sign-in') return <><Stage><SignIn cloud={cloud.data} /></Stage>{opened === 'join-link' && <JoinLinkDialog />}</>
  if (!cloud.data) return <Waiting />
  if (step === 'unlock') return <Stage><Unlock cloud={cloud.data} /></Stage>
  const active = activeOf({ workspaces: cloud.data.workspaces, chosen })
  if (!active) return <Waiting />
  return <GateContext value={{ cloud: cloud.data, active }}>{children}</GateContext>
}

function Waiting({ note }: { note?: string }) {
  return <div className="grid h-dvh place-items-center bg-sidebar"><span className="flex animate-[fadein_.3s_1s_both] flex-col items-center gap-3 px-8 text-center"><Spinner className="size-5" />{note && <span className="max-w-[320px] text-[14px] text-body">{note}</span>}</span></div>
}

function Down({ error, retrying, onRetry }: { error: Error | null; retrying: boolean; onRetry: () => void }) {
  const canceled = error instanceof UnlockCanceled
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-sidebar px-8 text-center">
    {canceled ? <p className="m-0 max-w-[280px] text-[15px] text-body">{error.message}</p> : <ErrorNote message={error instanceof DOMException ? 'OpenHut couldn’t open a secure connection to your computer.' : error?.message} />}
    <Button type="button" variant="secondary" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying…' : canceled ? 'Unlock' : 'Try again'}</Button>
  </div>
}

function GettingReady({ run, ready, onRetry, onOpen }: { run: FirstRun | undefined; ready: boolean; onRetry: () => void; onOpen: () => void }) {
  const steps = run?.steps ?? []
  const now = steps.find(([, , state]) => state === 'now' || state === 'failed')
  const doneCount = steps.filter(([, , state]) => state === 'done').length
  const value = ready ? 100 : Math.round(((doneCount + (now?.[3] ?? 0)) / Math.max(steps.length, 1)) * 100)
  const action = run?.failed
    ? <Button variant="primary" className={BIG} onClick={onRetry}><I icon={Refresh01Icon} size={16} />Try again</Button>
    : <Button variant="primary" className={cn(BIG, !ready && 'bg-[#2a2b2e] disabled:opacity-100')} disabled={!ready} autoFocus={ready} onClick={onOpen}>{!ready && <Spinner className="mt-0 border-white/30 border-t-white" />}{ready ? 'Open OpenHut' : 'Setting up'}</Button>
  return <Step happy={ready} title={ready ? 'Ready.' : 'Getting ready.'} line={ready ? 'Your agents live here now.' : 'Only the first time.'} action={action}>
    <Meter className="w-[320px] max-w-full" size="xs" value={value} aria-label="Getting ready" />
    <span key={now?.[0]} className={cn('animate-[fadein_.35s_ease-out] text-[14px] font-medium', now?.[2] === 'failed' ? 'text-fail' : 'text-ink')}>{ready ? 'All done' : now?.[0] ?? 'Starting'}</span>
  </Step>
}
