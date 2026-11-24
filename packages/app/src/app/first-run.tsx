import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppleIcon, Mail01Icon } from '@hugeicons/core-free-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { Button, buttonVariants } from '@/components/ui/button'
import { BIG, EntryScreen, INK, QUIET, Stage } from '@/features/cloud/step'
import { Command } from '@/features/settings/kit'
import { joinCommand, useNow } from '@/features/settings/computers'
import { ago } from '@/lib/format'
import { remote } from '@/lib/remote'
import { DOWNLOAD_MAC, FIRST_RUN_KEY, HELP, savedOf, type FirstRunStep } from '@/lib/web-first-run'
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

export function FirstRun({ email, link }: { email: string; link?: ReactNode }) {
  const [step, setStep] = useState(load)
  const [resumed, setResumed] = useState(() => step?.step === 'mac')
  const go = (next: FirstRunStep | null) => {
    keep(next)
    setStep(next)
    setResumed(false)
  }
  if (step?.step === 'mac' && resumed) return <Stage><EntryScreen mood="looking" title="Welcome back." line={`Open OpenHut on your computer and sign in as ${email}.`}
    waiting="Listening for a computer on your account" foot={<><Button type="button" variant="text" className={QUIET} onClick={() => go(null)}>Pick another way</Button>{link}</>} /></Stage>
  if (step?.step === 'mac') return <Stage><EntryScreen mood="looking" title="Waiting for your computer…" line={`Open OpenHut on your Mac and sign in as ${email}. This page moves on by itself.`}
    waiting="Listening for a computer on your account"
    foot={<><a href="openhut://open" className={cn(buttonVariants({ variant: 'text' }), QUIET)}>I already have OpenHut</a><Button type="button" variant="text" className={QUIET} onClick={() => go({ step: 'server' })}>Run on my server instead</Button><a href={HELP} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'text' }), QUIET)}>Help</a></>} /></Stage>
  if (step?.step === 'server') return <Stage><ServerCommand step={step} onCode={go} onBack={() => go(null)} /></Stage>
  return <Stage><EntryScreen mood="looking" title="Where should your agents live?" line="On a computer you own. Add more later." foot={link}
    action={<>
      <a href={DOWNLOAD_MAC} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'primary' }), BIG)} onClick={() => go({ step: 'mac' })}><I icon={AppleIcon} size={16} />Download for Mac</a>
      <Button type="button" variant="text" className={INK} onClick={() => go({ step: 'server' })}>Run on my Linux server instead</Button>
    </>} /></Stage>
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
  return <Stage><EntryScreen mood="asleep" title="Your computer is offline." line={`${who} ${seen ? `was last seen ${ago(new Date(seen).toISOString())} ago` : 'isn’t online'}. Wake it, or open OpenHut on it.`}
    waiting="Listening for your computers"
    foot={<><Button type="button" variant="text" className={QUIET} onClick={() => setAdding({})}>Add a server that stays on</Button><a href={HELP} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'text' }), QUIET)}>Help</a></>} /></Stage>
}

export function PhoneFirstRun({ email, link }: { email: string; link?: ReactNode }) {
  const url = location.origin
  return <Stage><EntryScreen mood="looking" title="Set up on a computer." line="Send yourself the link and open it on your computer." foot={<><CopyButton text={url} label="Copy link" variant="text" className={QUIET} />{link}</>}
    action={<a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Set up OpenHut')}&body=${encodeURIComponent(url)}`} className={cn(buttonVariants({ variant: 'primary' }), BIG)}><I icon={Mail01Icon} size={16} />Email me the link</a>} /></Stage>
}
