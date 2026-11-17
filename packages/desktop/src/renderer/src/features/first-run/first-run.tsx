import { useEffect, useState, type ReactNode } from 'react'
import { Clock01Icon, Key01Icon, PlayIcon, Refresh01Icon, Shield01Icon, ZapIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Hut } from '@/components/hut'
import { ErrorNote } from '@/components/error-note'
import { HERE, useFirstRun } from '@/features/settings/desktop'
import { I } from '@/components/kit'
import { Progress } from '@/features/settings/kit'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

export function FirstRun() {
  const [started, setStarted] = useState(false)
  const run = useFirstRun(started)
  const agentId = run.data?.agentId
  useEffect(() => { if (agentId) navigate(`/agents/${encodeURIComponent(agentId)}`, true) }, [agentId])
  return <div className="flex h-dvh flex-col bg-canvas text-ink">
    <div className="flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute in-data-desktop:select-none in-data-desktop:[-webkit-app-region:drag]">{started ? 'OpenHut' : ''}</div>
    {started ? <Starting run={run.data} error={run.error?.message} onRetry={() => void run.refetch()} /> : <Welcome onStart={() => setStarted(true)} />}
  </div>
}

function Welcome({ onStart }: { onStart: () => void }) {
  return <Center>
    <div className="relative"><span className="absolute inset-0 scale-150 rounded-md bg-[radial-gradient(circle,#f7c94855,transparent_65%)]" /><Hut className="relative size-28" /></div>
    <Headline>Your agents. On this {HERE}.</Headline>
    <p className="m-0 max-w-[440px] text-[14px]/[1.5] text-body">Each agent gets its own sealed computer. Chats, memory and keys stay here. There's no account to make.</p>
    <Button variant="primary" size="lg" className="mt-2 w-[240px] justify-center gap-2" onClick={onStart} autoFocus><I icon={PlayIcon} size={15} />Start</Button>
    <div className="mt-2 flex items-center gap-5 text-[12px] text-mute">
      <span className="inline-flex items-center gap-1.5"><I icon={Shield01Icon} size={14} />Sealed per agent</span>
      <span className="inline-flex items-center gap-1.5"><I icon={Key01Icon} size={14} />Keys in {HERE === 'Mac' ? 'Keychain' : 'your keyring'}</span>
      <span className="inline-flex items-center gap-1.5"><I icon={ZapIcon} size={14} />About 1 GB of memory per agent</span>
    </div>
  </Center>
}

function Starting({ run, error, onRetry }: { run: ReturnType<typeof useFirstRun>['data']; error: string | undefined; onRetry: () => void }) {
  return <Center>
    <Hut className={cn('size-20', !run?.failed && '[&>svg]:animate-hop')} />
    <Headline>Getting your hut ready</Headline>
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
