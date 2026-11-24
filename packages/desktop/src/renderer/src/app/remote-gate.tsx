import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Spinner } from '@/components/ui/spinner'
import { Knocking, YoureIn } from '@/features/cloud/knock'
import { BIG, Stage, Step } from '@/features/cloud/step'
import { followEvents } from '@/lib/live'
import { remote } from '@/lib/remote'

const WAIT_MS = 3000

export function RemoteGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string>()
  const [knocked, setKnocked] = useState(false)
  const state = useQuery({ queryKey: ['remote'], queryFn: remote.state, refetchInterval: (query) => query.state.data?.step === 'waiting' ? WAIT_MS : false, retry: false })
  const workspace = state.data?.step === 'ready' ? state.data.workspace : undefined
  const opened = useQuery({ queryKey: ['remote-tunnel', workspace], queryFn: async () => { await remote.open(workspace ?? ''); return true }, enabled: !!workspace, retry: false, staleTime: Infinity })
  useEffect(() => { if (opened.data) followEvents(client) }, [opened.data, client])
  if (opened.data && knocked) return <Stage><YoureIn line="Your computer let this browser in." onOpen={() => setKnocked(false)} /></Stage>
  if (opened.data) return children
  const failure = error ?? (state.error ?? opened.error)?.message
  if (state.data?.step === 'signed-out') return <Stage><Step title="Use OpenHut in your browser." line="Sign in with the Google account you use on your Mac.">
    <Button className={BIG} disabled={signingIn} onClick={() => { setSigningIn(true); remote.signIn().catch((err: Error) => { setError(err.message); setSigningIn(false) }) }}>{signingIn ? <Spinner /> : null}Continue with Google</Button>
    {failure && <ErrorNote message={failure} />}
  </Step></Stage>
  if (state.data?.step === 'waiting' && !knocked) setKnocked(true)
  if (state.data?.step === 'waiting') return <Stage><Knocking faces={state.data.faces} /></Stage>
  if (state.data?.step === 'over') return <Stage><Step title={state.data.missed ? 'Those faces didn’t match.' : 'Nobody let you in.'} line={state.data.missed ? 'The request was turned down. If that was you, knock again.' : 'The knock was turned down, or 15 minutes passed.'}
    action={<Button className={BIG} onClick={() => remote.knock().then(() => state.refetch(), (err: Error) => setError(err.message))}>Knock again</Button>}>{failure && <ErrorNote message={failure} />}</Step></Stage>
  return <Stage><Step title={failure ? 'Can’t reach your computer.' : 'Connecting to your computer…'} line={failure ?? 'Your agents run on your Mac. This browser talks to it end to end encrypted.'}>
    {failure ? <Button className={BIG} onClick={() => { setError(undefined); void state.refetch(); void opened.refetch() }}>Try again</Button> : <Spinner />}
  </Step></Stage>
}
