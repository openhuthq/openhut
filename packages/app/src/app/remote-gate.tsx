import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Spinner } from '@/components/ui/spinner'
import { FirstRun, forgetFirstRun, Offline, PhoneFirstRun } from '@/app/first-run'
import { Knocking, YoureIn } from '@/features/cloud/knock'
import { nameOf } from '@/features/cloud/api'
import { Teammate } from '@/app/teammate'
import { BIG, Stage, Step } from '@/features/cloud/step'
import { SignInScreen, TITLE } from '@/features/cloud/sign-in'
import { cn } from '@/lib/utils'
import { followEvents } from '@/lib/live'
import { CloudOffline, remote } from '@/lib/remote'
import { Offline as Away, phoneBrowser, screenOf } from '@/lib/web-first-run'

const WAIT_MS = 3000
const OFFLINE_MS = 5000
const SETUP_MS = 1500
const POLLED = ['waiting', 'first-run', 'continuing']

export function RemoteGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string>()
  const [knocked, setKnocked] = useState(false)
  const state = useQuery({ queryKey: ['remote'], queryFn: remote.state, refetchInterval: (query) => query.state.data?.step === 'setup' ? SETUP_MS : POLLED.includes(query.state.data?.step ?? '') || query.state.error instanceof CloudOffline ? WAIT_MS : false, retry: false })
  const workspace = state.data?.step === 'ready' ? state.data.workspace : undefined
  const opened = useQuery({ queryKey: ['remote-tunnel', workspace], queryFn: async () => { await remote.open(workspace ?? ''); return true }, enabled: !!workspace, retry: false, staleTime: Infinity, refetchInterval: (query) => query.state.error instanceof Away || query.state.error instanceof CloudOffline ? OFFLINE_MS : false })
  useEffect(() => {
    if (!opened.data) return
    followEvents(client)
    void client.invalidateQueries({ predicate: (query) => !['remote', 'remote-tunnel'].includes(String(query.queryKey[0])) })
  }, [opened.data, client])
  const step = state.data?.step
  useEffect(() => { if (step && step !== 'first-run') forgetFirstRun() }, [step])
  const cut = useSyncExternalStore(remote.watchCut, remote.cut)
  useEffect(() => {
    if (!cut) return
    const retry = setInterval(() => void remote.reconnect(), OFFLINE_MS)
    return () => clearInterval(retry)
  }, [cut])
  const screen = screenOf({ step, opened: Boolean(opened.data), error: opened.error, phone: phoneBrowser({ userAgent: navigator.userAgent, width: innerWidth }) })
  if (opened.data && cut) return <CloudDown />
  if (opened.data && knocked) return <Stage><YoureIn line="Your computer let this browser in." onOpen={() => setKnocked(false)} /></Stage>
  if (opened.data && state.data?.step === 'ready' && state.data.teammate) return <Teammate />
  if (opened.data || state.data?.step === 'setup') return children
  const failure = error ?? (state.error ?? opened.error)?.message
  if (state.error instanceof CloudOffline || opened.error instanceof CloudOffline) return <CloudDown />
  const invited = state.data?.step === 'signed-out' || state.data?.step === 'waiting' ? state.data.invited : null
  const host = nameOf(invited?.from ?? '') || 'Your teammate'
  if (state.data?.step === 'signed-out') return <Stage><SignInScreen title={invited ? `You’re invited to ${invited.team ?? 'a team'}.` : TITLE} line={invited ? `Sign in with Google${invited.email ? ` as ${invited.email}` : ''} to chat with the agents ${host} shares. Nothing to install.` : 'Use the Google account from your computer.'}
    invited={Boolean(invited)} busy={signingIn} busyLabel="Opening Google…" disabled={signingIn} onSignIn={() => { setSigningIn(true); remote.signIn().catch((err: Error) => { setError(err.message); setSigningIn(false) }) }}>
    {failure && <ErrorNote message={failure} />}
  </SignInScreen></Stage>
  const otherAccount = <Button type="button" variant="text" className="font-normal text-mute" onClick={() => void remote.signOut().then(() => state.refetch())}>Use another account</Button>
  if (screen === 'first-run' && state.data?.step === 'first-run') return <FirstRun email={state.data.email} link={otherAccount} />
  if (screen === 'phone' && state.data?.step === 'first-run') return <PhoneFirstRun email={state.data.email} link={otherAccount} />
  if (screen === 'offline' && opened.error instanceof Away) return <Offline computer={opened.error.computer} seen={opened.error.seen} />
  if (state.data?.step === 'waiting' && !knocked) setKnocked(true)
  if (state.data?.step === 'continuing') return <Stage><Step title="Opening OpenHut…" line="Your computer is letting this browser in. This takes a few seconds."><Spinner /></Step></Stage>
  if (state.data?.step === 'waiting' && invited) return <Stage><Knocking faces={state.data.faces} line={`Tell ${host} these two. ${host} taps them on their computer.`} link={otherAccount} /></Stage>
  if (state.data?.step === 'waiting') return <Stage><Knocking faces={state.data.faces}
    action={<a href="openhut://open" className={cn(buttonVariants({ variant: 'primary' }), BIG)}>Open OpenHut</a>} link={otherAccount} /></Stage>
  const over = state.data?.step === 'over' ? state.data : undefined
  if (over) return <Stage><Step title={over.missed ? 'Those faces didn’t match.' : 'Nobody let you in.'} line={over.missed ? 'The request was turned down. If that was you, knock again.' : 'The knock was turned down, or 15 minutes passed.'} link={otherAccount}
    action={<Button className={BIG} onClick={() => remote.knock(over.workspace).then(() => state.refetch(), (err: Error) => setError(err.message))}>Knock again</Button>}>{failure && <ErrorNote message={failure} />}</Step></Stage>
  return <Stage><Step title={failure ? 'Can’t reach your computer.' : 'Connecting to your computer…'} line={failure ?? 'Your agents run on your Mac. This browser talks to it end to end encrypted.'}>
    {failure ? <Button className={BIG} onClick={() => { setError(undefined); void state.refetch(); void opened.refetch() }}>Try again</Button> : <Spinner />}
  </Step></Stage>
}

function CloudDown() {
  return <Stage><Step title="Can’t reach OpenHut Cloud." line="Check this computer’s internet connection. OpenHut tries again on its own."><Spinner /></Step></Stage>
}
