import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock01Icon, Key01Icon, PlayIcon, Refresh01Icon, ServerStack01Icon, Shield01Icon, UserGroupIcon, UserIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { joinPathOf } from '@/features/join/cloud-join'
import { Hut } from '@/components/hut'
import { ErrorNote } from '@/components/error-note'
import { useFirstRun } from '@/features/settings/desktop'
import { WORDS } from '@/lib/platform'
import { I } from '@/components/kit'
import { Progress } from '@/features/settings/kit'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

export function FirstRun() {
  const [started, setStarted] = useState(false)
  const run = useFirstRun(started)
  const agentId = run.data?.agentId
  const queries = useQueryClient()
  useEffect(() => {
    if (!agentId) return
    void queries.invalidateQueries()
    navigate(`/agents/${encodeURIComponent(agentId)}`, true)
  }, [agentId, queries])
  return <div className="flex h-dvh flex-col bg-canvas text-ink">
    <div className="flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute in-data-desktop:select-none in-data-desktop:[-webkit-app-region:drag]">{started ? 'OpenHut' : ''}</div>
    {started && <Starting run={run.data} error={run.error?.message} onRetry={() => void run.refetch()} />}
    {!started && !run.isPending && <Welcome invite={run.data?.invite ?? null} onStart={() => setStarted(true)} />}
  </div>
}

function Welcome({ invite, onStart }: { invite: string | null; onStart: () => void }) {
  const [joining, setJoining] = useState(!!invite)
  if (joining) return <JoinTeam invite={invite} onStart={onStart} />
  return <Center>
    <div className="relative"><span className="absolute inset-0 scale-150 rounded-md bg-[radial-gradient(circle,#f7c94855,transparent_65%)]" /><Hut className="relative size-28" /></div>
    <Headline>Your agents. On this computer.</Headline>
    <p className="m-0 max-w-[440px] text-[14px]/[1.5] text-body">{WORDS.sandboxed ? 'Each agent is sealed in its own box.' : 'Agents run on this computer like any app you install, with your access.'} Chats, memory and keys stay here. No account needed.</p>
    <Button variant="primary" size="lg" className="mt-2 w-[240px] justify-center gap-2" onClick={onStart} autoFocus><I icon={PlayIcon} size={15} />Start on your own</Button>
    <Button variant="secondary" size="lg" className="w-[240px] justify-center gap-2" onClick={() => setJoining(true)}><I icon={UserGroupIcon} size={15} />Join your team</Button>
    <div className="mt-2 flex items-center gap-5 text-[12px] text-mute">
      <span className="inline-flex items-center gap-1.5"><I icon={WORDS.sandboxed ? Shield01Icon : UserIcon} size={14} />{WORDS.sandboxed ? 'Sealed per agent' : 'With your access'}</span>
      <span className="inline-flex items-center gap-1.5"><I icon={Key01Icon} size={14} />Keys in the {WORDS.keychain}</span>
      <span className="inline-flex items-center gap-1.5"><I icon={ServerStack01Icon} size={14} />Add a computer anytime</span>
    </div>
  </Center>
}

function JoinTeam({ invite, onStart }: { invite: string | null; onStart: () => void }) {
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = joinPathOf(String(new FormData(event.currentTarget).get('link') ?? ''))
    if (path) navigate(path)
    else setError('That isn’t an invite link. Copy the whole link from your invite email.')
  }
  return <Center>
    <Hut mood="party" className="size-28" />
    <Headline>{invite ? 'You’re invited to a team' : 'Join your team'}</Headline>
    <p className="m-0 max-w-[440px] text-[14px]/[1.5] text-body">{invite ? 'Your invite link is ready. Sign in with the email it was sent to.' : 'Paste the invite link from your email.'}</p>
    <form onSubmit={submit} className="mt-2 flex w-[300px] flex-col gap-3">
      <Input name="link" aria-label="Invite link" defaultValue={invite ?? ''} placeholder="https://openhut.dev/join#…" autoComplete="off" spellCheck={false} autoFocus={!invite} />
      <ErrorNote message={error} />
      <Button type="submit" variant="primary" size="lg" className="justify-center gap-2" autoFocus={!!invite}><I icon={UserGroupIcon} size={15} />Join your team</Button>
    </form>
    <Button variant="ghost" className="justify-center" onClick={onStart}>Start on your own</Button>
  </Center>
}

function Starting({ run, error, onRetry }: { run: ReturnType<typeof useFirstRun>['data']; error: string | undefined; onRetry: () => void }) {
  return <Center>
    <Hut className={cn('size-20', !run?.failed && '[&>svg]:animate-hop')} />
    <Headline>Getting OpenHut ready</Headline>
    <div className="mt-2 w-[480px] rounded-lg border border-hair bg-card p-4 text-left"><Progress rows={run?.steps ?? []} /></div>
    <ErrorNote message={error} />
    {run?.failed
      ? <Button variant="secondary" className="gap-2" onClick={onRetry}><I icon={Refresh01Icon} size={14} />Try again</Button>
      : <span className="inline-flex items-center gap-1.5 text-[12px] text-mute"><I icon={Clock01Icon} size={13} />Only the first time. After this it starts in about ten seconds.</span>}
  </Center>
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
}

function Headline({ children }: { children: ReactNode }) {
  return <h1 className="m-0 text-[20px]/[1.3] font-semibold text-ink">{children}</h1>
}
