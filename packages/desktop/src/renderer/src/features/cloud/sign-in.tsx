import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { CheckmarkCircle02Icon, ComputerPhoneSyncIcon, File01Icon, SourceCodeIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Cloud, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { kitText, readKit } from '@openhut/common/vault/kit-file.ts'
import { migrating } from '@/app/gate-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { CopyButton } from '@/components/copy-button'
import { DropZone } from '@/components/custom/drop-zone'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { useCancelSignIn, useCloud, useNewKit, useSignIn, useSigningIn } from '@/features/cloud/api'
import { PRIMARY, Step } from '@/features/cloud/step'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { open, usePath } from '@/lib/router'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

const POINTS = [
  [ComputerPhoneSyncIcon, 'Your agents and chats follow you to every computer you add'],
  [SquareLock02Icon, 'Encrypted on your device. No one can read it, including us'],
  [SourceCodeIcon, 'Open source, so anyone can check how it works'],
] as const
const INVITED = 'Sign in with the email your invite went to. Everything you share there stays end-to-end encrypted.'
const SWAP = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition-[opacity,translate] duration-300 ease-[cubic-bezier(.22,1,.36,1)]'

export function SignIn({ cloud }: { cloud: Cloud | undefined }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  const cancel = useCancelSignIn()
  const online = useOnline()
  const agents = useAgents().data?.length ?? 0
  const invited = usePath() === '/join'
  const moving = migrating({ agents, invited })
  const busy = waiting || signIn.isPending
  const action = isPhone() ? undefined : <Button type="button" variant="primary" className={cn(PRIMARY, 'grid', busy && 'bg-[#2a2b2e]')} disabled={!online || signIn.isPending} onClick={() => signIn.mutate()}>
    <span className={cn(SWAP, busy && '-translate-y-2.5 opacity-0')}><Google size={17} />Continue with Google</span>
    <span className={cn(SWAP, !busy && 'translate-y-2.5 opacity-0')} aria-hidden={!busy}><Spinner className="mt-0 border-white/30 border-t-white" />Finish in your browser</span>
  </Button>
  const quiet = !invited && !isPhone() && <Button type="button" variant="text" onClick={() => open('join-link')}>I have an invite link</Button>
  const link = waiting ? <span className="text-mute">Google opened in your browser · <Button type="button" variant="text" className="font-normal text-mute" onClick={cancel}>Cancel</Button></span> : quiet
  const [title, line] = invited ? ['You’re invited.', INVITED] : [moving ? 'Sign in to keep going.' : 'Your agents, everywhere.', moving]
  return <Step title={title} line={line} action={action} link={link}>
    {!invited && <ul className="m-0 flex list-none flex-col gap-3 p-0 text-left">{POINTS.map(([icon, text]) => <li key={text} className="flex items-center gap-3 text-[15px]/[1.4] text-body"><I icon={icon} size={18} className="shrink-0 text-mute" />{text}</li>)}</ul>}
    {isPhone() && <p className="m-0 text-[13px] text-mute">Sign in to OpenHut on your computer.</p>}
    {online ? <ErrorNote className="max-w-[420px]" message={signIn.error?.message ?? cloud?.signInError ?? undefined} /> : <p className="m-0 text-[13px] text-mute">OpenHut needs the internet the first time.</p>}
  </Step>
}

function useOnline(): boolean {
  return useSyncExternalStore((listener) => {
    addEventListener('online', listener)
    addEventListener('offline', listener)
    return () => {
      removeEventListener('online', listener)
      removeEventListener('offline', listener)
    }
  }, () => navigator.onLine)
}

type KitBridge = { save: (input: { name: string; body: string }) => Promise<{ canceled?: boolean; text?: string }> }
const kitBridge: KitBridge | undefined = Reflect.get(window, 'openhut')?.kit
type KitStep = 'save' | 'paste' | 'drop' | 'words' | 'type'
const LINK = 'font-normal text-ink'

export function SaveKit({ onBack, onDone }: { onBack?: () => void; onDone: () => void }) {
  const cloud = useCloud().data
  const make = useNewKit()
  const [kit, setKit] = useState<RecoveryKit>()
  const [replaced, setReplaced] = useState(false)
  const [step, setStep] = useState<KitStep>('save')
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const email = cloud?.email ?? ''
  const old = Boolean(cloud?.kit && !cloud.kit.differs)
  const young = cloud?.youngUntil
  const name = `OpenHut Recovery Kit (${email}).txt`
  const textOf = (made: RecoveryKit) => kitText({ email, madeAt: made.madeAt, device: made.device, kitId: made.kitId, words: made.words })
  const same = (other: string | undefined) => Boolean(kit) && readKit(other ?? '')?.words.join(' ') === kit?.words.join(' ')
  const go = (next: KitStep) => {
    setError(undefined)
    setStep(next)
  }
  const finish = () => {
    setSaved(true)
    go('save')
  }
  const ready = async () => {
    if (kit) return kit
    const made = await make.mutateAsync()
    setReplaced(old)
    setKit(made)
    return made
  }
  const run = (task: () => Promise<unknown>) => void task().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  const save = async () => {
    const made = await ready()
    const text = textOf(made)
    if (!kitBridge) {
      download({ name, text })
      return go('drop')
    }
    const saved = await kitBridge.save({ name, body: text })
    if (saved.canceled) return
    if (readKit(saved.text ?? '')?.words.join(' ') !== made.words.join(' ')) return setError('The saved file doesn’t match your kit. Save it again.')
    finish()
  }
  const copy = async () => {
    if (await copyText(textOf(await ready()))) go('paste')
  }
  const words = async () => {
    await ready()
    go('words')
  }
  const check = (pasted: string) => same(pasted) ? finish() : setError(readKit(pasted) ? 'That’s a different kit. Use the one you just saved.' : 'That doesn’t look like your kit. Try again.')
  if (step === 'words' && kit) return <KitWords kit={kit} replaced={replaced} onBack={isPhone() ? onBack : () => go('save')} onSaved={() => go('type')} />
  if (step === 'type' && kit) return <ConfirmKit kit={kit} onBack={() => go('words')} onDone={finish} />
  if (step === 'paste' || step === 'drop') return <KitCheck how={step} error={error} onText={check} onBack={() => go('save')} />
  const ways = !young && !isPhone() && !saved && <span className="text-mute"><Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(copy)}>Copy it</Button> · <Button type="button" variant="text" className={LINK} disabled={make.isPending} onClick={() => run(words)}>write it down</Button></span>
  const label = isPhone() ? 'Show the words' : 'Save kit'
  return <Step happy={saved} title={old && !kit ? 'New recovery kit.' : 'Save your recovery kit.'} line="Lose every computer? This gets you back in." back={saved ? undefined : onBack} link={ways}
    action={!young && <Button type="button" variant="primary" className={PRIMARY} autoFocus={saved} disabled={make.isPending} onClick={saved ? onDone : () => run(isPhone() ? words : save)}>{saved ? 'Continue' : label}</Button>}>
    {!young && <KitCard email={email} saved={saved} />}
    {old && !kit && <p className="m-0 font-medium text-ink">{cloud?.passkey ? 'The old kit and Touch ID stop working.' : 'The old kit stops working.'}</p>}
    {young && <p className="m-0 max-w-[420px] text-[12.5px] text-mute">This computer was added less than 3 days ago. Make a kit after {shortDate.format(new Date(young))}, or on an older one.</p>}
    <ErrorNote message={error} />
  </Step>
}

function KitCard({ email, saved }: { email: string; saved: boolean }) {
  return <div className="flex w-full max-w-[420px] items-center gap-3 rounded-xl border border-hair bg-card px-4 py-3.5 text-left">
    <I icon={File01Icon} size={22} className="text-hue-amber" />
    <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[14px] font-medium text-ink">OpenHut Recovery Kit</span><span className="truncate text-[12.5px] text-mute">12 words · {email}</span></span>
    <span className={cn('inline-flex items-center gap-1 text-[12.5px] font-medium text-pass transition-opacity duration-300', !saved && 'opacity-0')}><I icon={CheckmarkCircle02Icon} size={15} />Saved</span>
  </div>
}

function KitCheck({ how, error, onText, onBack }: { how: 'paste' | 'drop'; error?: string; onText: (text: string) => void; onBack: () => void }) {
  return <Step title={how === 'paste' ? 'Paste it back.' : 'Drop it back.'} line="So we know it’s saved." back={onBack}>
    <DropZone className="w-full max-w-[420px]" onText={onText}>{() => <>
      <span className="font-medium text-ink">{how === 'paste' ? 'Paste it here' : 'Drop your kit here'}</span>
      <span className="text-[12.5px] text-mute">{how === 'paste' ? 'or drop the file' : 'or paste it'}</span>
    </>}</DropZone>
    <ErrorNote message={error} />
  </Step>
}

function numbered(kit: RecoveryKit): string {
  return kit.words.map((word, index) => `${index + 1}. ${word}`).join('\n')
}

function download({ name, text }: { name: string; text: string }) {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name })
  link.click()
  URL.revokeObjectURL(link.href)
}

function KitWords({ kit, replaced, onBack, onSaved }: { kit: RecoveryKit; replaced: boolean; onBack?: () => void; onSaved: () => void }) {
  return <Step title="Your 12 words." line={replaced ? 'Your old words stop working now.' : 'Write them down and keep them safe.'} back={onBack}
    link={<CopyButton text={numbered(kit)} label="Copy" variant="text" size="none" className="font-normal text-mute" />}
    action={<Button type="button" variant="primary" className={PRIMARY} onClick={onSaved}>I wrote them down</Button>}>
    <div className="grid w-full max-w-[420px] grid-cols-3 gap-2 text-left phone:grid-cols-2">{kit.words.map((word, index) => <span key={index} className="flex items-center gap-2 rounded-lg border border-hair bg-card px-3 py-2 font-mono text-[13px]"><span className="w-4 text-right text-[11px] text-mute">{index + 1}</span>{word}</span>)}</div>
  </Step>
}

function ConfirmKit({ kit, onBack, onDone }: { kit: RecoveryKit; onBack: () => void; onDone: () => void }) {
  const [wrong, setWrong] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const right = kit.ask.every((index) => String(form.get(`word-${index}`) ?? '').trim().toLowerCase() === kit.words[index])
    if (right) onDone()
    setWrong(!right)
  }
  return <Step title="Check your words." line="Type two of them." back={onBack} action={<Button type="submit" form="check-kit" variant="primary" className={PRIMARY}>Check</Button>}>
    <form id="check-kit" onSubmit={submit} className="flex w-full max-w-[320px] flex-col gap-3 text-left">
      {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
      <ErrorNote message={wrong ? 'Those don’t match. Check the word numbers.' : undefined} />
    </form>
  </Step>
}

function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
