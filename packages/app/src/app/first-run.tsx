import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppleIcon, Mail01Icon, ServerStack01Icon } from '@hugeicons/core-free-icons'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { BIG, Stage, Step } from '@/features/cloud/step'
import { Command } from '@/features/settings/kit'
import { joinCommand, Scene, useNow, Waiting } from '@/features/settings/computers'
import { ago } from '@/lib/format'
import { remote } from '@/lib/remote'
import { DOWNLOAD_MAC, FIRST_RUN_KEY, HELP, savedOf, type FirstRunStep } from '@/lib/web-first-run'
import { cn } from '@/lib/utils'

const LINK = 'font-normal text-mute'

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
  if (step?.step === 'mac' && resumed) return <Stage><Step mood="looking" title="Welcome back." line={`You were setting up OpenHut on a Mac. Open it there and sign in as ${email}; this page moves on by itself.`}
    action={<Button type="button" variant="secondary" className={BIG} onClick={() => go(null)}>Pick another way</Button>}><Listening /></Step></Stage>
  if (step?.step === 'mac') return <Stage><Step mood="looking" title="Waiting for your computer…" line={`Open OpenHut on your Mac and sign in as ${email}. This page moves on by itself.`}
    link={<><a href="openhut://open" className={cn(buttonVariants({ variant: 'text' }), LINK)}>I already have OpenHut</a><Button type="button" variant="text" className={LINK} onClick={() => go({ step: 'server' })}>Run on my server instead</Button><a href={HELP} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'text' }), LINK)}>Help</a></>}>
    <Listening />
  </Step></Stage>
  return <>
    <Stage><Step title="Where should your agents live?" line="On a computer you own. You can add more later." link={link}
      action={<div className="flex flex-col items-center gap-2.5">
        <a href={DOWNLOAD_MAC} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'primary' }), BIG)} onClick={() => go({ step: 'mac' })}><I icon={AppleIcon} size={16} />Download for Mac</a>
        <Button type="button" variant="secondary" className={BIG} onClick={() => go({ step: 'server' })}><I icon={ServerStack01Icon} size={16} />Run on my server</Button>
      </div>} /></Stage>
    {step?.step === 'server' && <ServerCommand step={step} onCode={go} onBack={() => go(null)} />}
  </>
}

export function ServerCommand({ step, onCode, onBack }: { step: { code?: string; expiresAt?: string }; onCode: (step: FirstRunStep) => void; onBack: () => void }) {
  const make = useMutation({ mutationFn: remote.joinCode, onSuccess: ({ code, expiresAt }) => onCode({ step: 'server', code, expiresAt }) })
  const { mutate } = make
  const missing = !step.code
  useEffect(() => { if (missing) mutate() }, [missing, mutate])
  const now = useNow(Boolean(step.code))
  const expired = Boolean(step.expiresAt && now > Date.parse(step.expiresAt))
  return <Dialog size="narrow" label="Run on my server" onClose={onBack}>
    <DialogHead title="Run on a Linux server" onClose={onBack} />
    <div className="flex flex-col gap-4 px-3 py-5 text-[13px]/[18px]">
      <ErrorNote message={make.error?.message} />
      {!step.code && make.isPending && <Waiting note="It works once, for 10 minutes.">Making a command…</Waiting>}
      {step.code && !expired && <>
        <p className="m-0 text-body">Run this on any Linux server or VPS you have. It becomes your first computer.</p>
        <Command text={joinCommand(step.code)} />
        <p className="m-0 text-[12px]/[16px] text-mute">Ubuntu, Debian or Alpine, x86_64 or arm64, with sudo. It installs Docker if needed and takes about 2 GB. You pay whoever hosts the server.</p>
        <Waiting note="The command works once, for 10 minutes. This moves on by itself.">Waiting for your server…</Waiting>
      </>}
      {expired && <Scene mood="worried" title="Didn't hear from it" line="The command works for 10 minutes, and that time is up. If you ran it, the server printed why it couldn't join. Make a new command and run it again." />}
    </div>
    <DialogFoot start={<Button type="button" variant="secondary" onClick={onBack}>Back</Button>}>{expired && <Button type="button" variant="primary" disabled={make.isPending} onClick={() => mutate()}>Make a new command</Button>}</DialogFoot>
  </Dialog>
}

export function Offline({ computer, seen }: { computer: string | null; seen: number | null }) {
  const [adding, setAdding] = useState<{ code?: string; expiresAt?: string } | null>(null)
  const who = computer ?? 'Your computer'
  return <>
    <Stage><Step mood="asleep" title="Your computer is offline." line={`${who} ${seen ? `was last seen ${ago(new Date(seen).toISOString())} ago` : 'isn’t online'}. Wake it, or open OpenHut on it. This page moves on by itself.`}
      action={<Button type="button" variant="secondary" className={BIG} onClick={() => setAdding({})}><I icon={ServerStack01Icon} size={16} />Add a server that stays on</Button>}
      link={<a href={HELP} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'text' }), LINK)}>Help</a>}>
      <Listening>Listening for your computers</Listening>
    </Step></Stage>
    {adding && <ServerCommand step={adding} onCode={(step) => setAdding(step.step === 'server' ? step : null)} onBack={() => setAdding(null)} />}
  </>
}

export function PhoneFirstRun({ email, link }: { email: string; link?: ReactNode }) {
  const url = location.origin
  return <Stage><Step title="Set up on a computer." line="Your agents run on a Mac or a Linux server. Send yourself the link and open it there. After that, this phone can chat with them." link={link}
    action={<div className="flex flex-col items-center gap-2.5">
      <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Set up OpenHut')}&body=${encodeURIComponent(url)}`} className={cn(buttonVariants({ variant: 'primary' }), BIG)}><I icon={Mail01Icon} size={16} />Email me the link</a>
      <CopyButton text={url} label="Copy link" className={BIG} />
    </div>} /></Stage>
}

function Listening({ children = 'Listening for a computer on your account' }: { children?: string }) {
  return <p className="m-0 flex items-center gap-2 text-[14px] text-body"><Spinner className="mt-0" />{children}</p>
}
