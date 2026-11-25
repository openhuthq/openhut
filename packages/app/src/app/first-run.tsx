import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CloudIcon } from '@hugeicons/core-free-icons'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { Button, buttonVariants } from '@/components/ui/button'
import { BIG, EntryScreen, INK, QUIET, Stage } from '@/features/cloud/step'
import { Command } from '@/features/settings/kit'
import { joinCommand, useNow } from '@/features/settings/computers'
import { ago } from '@/lib/format'
import { remote } from '@/lib/remote'
import { FIRST_RUN_KEY, HELP, savedOf, type FirstRunStep } from '@/lib/web-first-run'
import { cn } from '@/lib/utils'

function load(): FirstRunStep | null {
  try {
    return savedOf(localStorage.getItem(FIRST_RUN_KEY))
  } catch {
    return null
  }
}

function keep(step: FirstRunStep | null) {
  try {
    if (step) localStorage.setItem(FIRST_RUN_KEY, JSON.stringify(step))
    else localStorage.removeItem(FIRST_RUN_KEY)
  } catch {
    return
  }
}

export function forgetFirstRun() {
  keep(null)
}

export function FirstRun({ link }: { link?: ReactNode }) {
  const [step, setStep] = useState(load)
  const go = (next: FirstRunStep | null) => {
    keep(next)
    setStep(next)
  }
  if (step?.step === 'server') return <Stage><ServerCommand step={step} onCode={go} onBack={() => go(null)} /></Stage>
  if (step?.step === 'cloud') return <Stage><StartCloud onBack={() => go(null)} /></Stage>
  return <Stage><EntryScreen mood="looking" title="Where should your agents live?" line="On Cloud, paid from your free credits, or on a computer you own. Add more later." foot={link}
    action={<>
      <Button type="button" variant="primary" className={BIG} onClick={() => go({ step: 'cloud' })}><I icon={CloudIcon} size={16} />Use Cloud</Button>
      <Button type="button" variant="text" className={INK} onClick={() => go({ step: 'server' })}>Run on my Linux server instead</Button>
    </>} /></Stage>
}

/** Cloud as the first computer: our servers start it, it joins, and lets this browser in. The page moves on by itself. */
function StartCloud({ onBack }: { onBack: () => void }) {
  const start = useMutation({ mutationFn: remote.startCloud })
  const { mutate } = start
  useEffect(() => mutate(), [mutate])
  const back = <Button type="button" variant="text" className={QUIET} data-back onClick={onBack}>Back</Button>
  if (start.error) return <EntryScreen mood="worried" title="Couldn’t start Cloud." line={start.error.message} foot={back}
    action={<Button type="button" variant="primary" className={BIG} onClick={() => mutate()}>Try again</Button>} />
  return <EntryScreen mood="building" title="Starting Cloud…" line="Your agents run here, even when your computer is off. This takes a minute or two." foot={back} waiting="Starting Cloud" />
}

/** A Linux server as the first computer: a full screen, not a dialog. */
export function ServerCommand({ step, onCode, onBack }: { step: { code?: string; expiresAt?: string }; onCode: (step: FirstRunStep) => void; onBack: () => void }) {
  const make = useMutation({ mutationFn: remote.joinCode, onSuccess: ({ code, expiresAt }) => onCode({ step: 'server', code, expiresAt }) })
  const { mutate } = make
  const missing = !step.code
  useEffect(() => { if (missing) mutate() }, [missing, mutate])
  const [needs, setNeeds] = useState(false)
  const now = useNow(Boolean(step.code))
  const left = step.expiresAt ? Date.parse(step.expiresAt) - now : 0
  const expired = Boolean(step.expiresAt) && left < 0
  const back = <Button type="button" variant="text" className={QUIET} data-back onClick={onBack}>Back</Button>
  if (expired) return <EntryScreen mood="worried" title="This command expired." line="Each one works once, for 10 minutes." foot={back}
    waiting={make.isPending && 'Making a command…'} action={<Button type="button" variant="primary" className={BIG} onClick={() => mutate()}>Make a new command</Button>}>
    <ErrorNote message={make.error?.message} />
  </EntryScreen>
  return <EntryScreen mood="building" title="Run this on your server." line="Any Linux server with sudo. It becomes your first computer."
    foot={<>{back}<Button type="button" variant="text" className={QUIET} aria-expanded={needs} onClick={() => setNeeds(!needs)}>Requirements</Button></>}
    waiting={step.code ? `Waiting for your server · ${clock(left)} left` : 'Making a command…'}>
    <ErrorNote message={make.error?.message} />
    {step.code && <div className="w-full text-left"><Command text={joinCommand(step.code)} /></div>}
    {needs && <p className="m-0 text-[12.5px]/[18px] text-balance text-mute">Ubuntu, Debian or Alpine, x86_64 or arm64, with sudo. It installs Docker if needed and takes about 2 GB. You pay whoever hosts the server.</p>}
  </EntryScreen>
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function Offline({ computer, seen }: { computer: string | null; seen: number | null }) {
  const [adding, setAdding] = useState<{ code?: string; expiresAt?: string } | null>(null)
  const who = computer ?? 'Your computer'
  if (adding) return <Stage><ServerCommand step={adding} onCode={(step) => setAdding(step.step === 'server' ? step : null)} onBack={() => setAdding(null)} /></Stage>
  return <Stage><EntryScreen mood="asleep" title="Your computer is offline." line={`${who} ${seen ? `was last seen ${ago(new Date(seen).toISOString())} ago` : 'isn’t online'}. Wake it, then come back.`}
    waiting="Listening for your computers"
    foot={<><Button type="button" variant="text" className={QUIET} onClick={() => setAdding({})}>Add a server that stays on</Button><a href={HELP} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'text' }), QUIET)}>Help</a></>} /></Stage>
}
