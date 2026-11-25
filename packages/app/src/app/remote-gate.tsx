import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Offline } from '@/app/first-run'
import { nameOf } from '@/features/cloud/api'
import { Teammate } from '@/app/teammate'
import { BIG, EntryScreen, QUIET, Stage } from '@/features/cloud/step'
import { invitedLines, LINE, SignInScreen, TITLE } from '@/features/cloud/sign-in'
import { useChosen } from '@/features/cloud/workspaces'
import { JoinCard } from '@/features/join/join-card'
import { followEvents } from '@/lib/live'
import { CloudOffline, remote } from '@/lib/remote'
import { Offline as Away, screenOf } from '@/lib/web-first-run'

const WAIT_MS = 3000
const OFFLINE_MS = 5000
const POLLED = ['waiting', 'first-run']

export function RemoteGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string>()
  const chosen = useChosen()
  const [joined, setJoined] = useState<string | null>(null)
  const state = useQuery({ queryKey: ['remote', chosen], queryFn: remote.state, placeholderData: keepPreviousData, refetchInterval: (query) => POLLED.includes(query.state.data?.step ?? '') || query.state.error instanceof CloudOffline ? WAIT_MS : false, retry: false })
  const workspace = state.data?.step === 'ready' ? state.data.workspace : undefined
  const opened = useQuery({ queryKey: ['remote-tunnel', workspace], queryFn: async () => { await remote.open(workspace ?? ''); return true }, enabled: !!workspace, retry: false, staleTime: Infinity, refetchInterval: (query) => query.state.error instanceof Away || query.state.error instanceof CloudOffline ? OFFLINE_MS : false })
  useEffect(() => {
    if (!opened.data) return
    followEvents(client)
    void client.invalidateQueries({ predicate: (query) => !['remote', 'remote-tunnel'].includes(String(query.queryKey[0])) })
  }, [opened.data, client])
  const cut = useSyncExternalStore(remote.watchCut, remote.cut)
  useEffect(() => {
    if (!cut) return
    const retry = setInterval(() => void remote.reconnect(), OFFLINE_MS)
    return () => clearInterval(retry)
  }, [cut])
  const screen = screenOf({ step: state.data?.step, opened: Boolean(opened.data), error: opened.error })
  if (opened.data && cut) return <CloudDown />
  if (opened.data && state.data?.step === 'ready' && state.data.teammate) return <Teammate />
  const step = state.data?.step
  if (opened.data || step === 'first-run' || (step === 'ready' && !state.data?.teammate && !opened.error)) return children
  const failure = error ?? (state.error ?? opened.error)?.message
  if (state.error instanceof CloudOffline || opened.error instanceof CloudOffline) return <CloudDown />
  const invited = state.data?.step === 'signed-out' || state.data?.step === 'waiting' ? state.data.invited : null
  const host = nameOf(invited?.from ?? '') || 'Your teammate'
  const [title, line] = invited ? invitedLines(invited) : [TITLE, LINE]
  if (state.data?.step === 'signed-out') return <Stage><SignInScreen title={title} line={line} hint={invited?.email ?? undefined}
    busy={signingIn} busyLabel="Opening Google…" disabled={signingIn} onSignIn={() => { setSigningIn(true); remote.signIn().catch((err: Error) => { setError(err.message); setSigningIn(false) }) }}>
    {failure && <ErrorNote message={failure} />}
  </SignInScreen></Stage>
  const otherAccount = <Button type="button" variant="text" className={QUIET} onClick={() => void remote.signOut().then(() => state.refetch())}>Use another account</Button>
  const asked = state.data?.step === 'invited' ? state.data : undefined
  if (asked) return <Stage><JoinCard invited={asked.invited} email={asked.email} onJoin={() => remote.knock(asked.invited.workspace).then(() => { setJoined(asked.invited.team ?? 'the team'); return state.refetch() })} onNotNow={() => void remote.notNow().then(() => state.refetch())} /></Stage>
  if (joined && !opened.data) return <Stage><EntryScreen mood="party" title={`You’re in ${joined}.`} waiting="Getting the team’s agents" /></Stage>
  if (screen === 'offline' && opened.error instanceof Away) return <Offline computer={opened.error.computer} seen={opened.error.seen} />
  if (state.data?.step === 'waiting') return <Stage><EntryScreen mood="looking" title="Letting you in…" line={invited ? `Joining ${invited.team ?? `${host}’s team`}.` : 'This takes a few seconds.'} waiting="Letting you in" foot={otherAccount} /></Stage>
  const over = state.data?.step === 'over' ? state.data : undefined
  if (over) return <Stage><EntryScreen mood="worried" title="You’re not in yet." line="This account isn’t on that team. Ask for a new invite, or try another account." foot={otherAccount}
    action={<Button variant="primary" className={BIG} onClick={() => remote.knock(over.workspace).then(() => state.refetch(), (err: Error) => setError(err.message))}>Try again</Button>}>{failure && <ErrorNote message={failure} />}</EntryScreen></Stage>
  if (!failure) return <Stage>{null}</Stage>
  return <Stage><EntryScreen mood="worried" title="Can’t reach your computer." line={failure}
    action={<Button variant="primary" className={BIG} onClick={() => { setError(undefined); void state.refetch(); void opened.refetch() }}>Try again</Button>} />
  </Stage>
}

function CloudDown() {
  return <Stage><EntryScreen mood="asleep" title="Can’t reach OpenHut Cloud." line="Check your internet. OpenHut keeps trying." waiting="Trying again" /></Stage>
}

