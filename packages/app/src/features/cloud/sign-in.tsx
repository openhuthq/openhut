import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { File01Icon, FingerPrintIcon } from '@hugeicons/core-free-icons'
import type { Cloud, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { kitText, readKit } from '@openhut/common/vault/kit-file.ts'
import { checksKit, migrating, type KitWay } from '@/app/gate-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { useAgents } from '@/features/agents/api'
import { PasskeyQuiet, useAddPasskey, useCancelSignIn, useCloud, useNewKit, usePasteSignInCode, useSignIn, useSigningIn } from '@/features/cloud/api'
import { notify } from '@/components/custom/toast'
import { toast, toastError } from '@/lib/toast'
import { desktop } from '@/lib/desktop'
import { BIG, EntryScreen, QUIET } from '@/features/cloud/step'
import { Check } from '@/features/settings/kit'
import { shortDate } from '@/lib/format'
import { isPhone } from '@/lib/native'
import { open, usePath } from '@/lib/router'
import { inviteOf } from '@/features/join/invite'
import { firstName } from '@/features/cloud/live'
import { copySecret } from '@/lib/clipboard'

const INVITED = 'Sign in with the email your invite went to. Everything in the team stays end-to-end encrypted.'

export function SignIn({ cloud }: { cloud: Cloud | undefined }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  const cancel = useCancelSignIn()
  const online = useOnline()
  const agents = useAgents().data?.length ?? 0
  const invited = usePath() === '/join'
  const invite = invited ? inviteOf(location.hash) : undefined
  const hint = invite?.email
  const moving = migrating({ agents, invited })
  const busy = waiting || signIn.isPending
  const ready = Boolean(cloud)
  const quiet = !invited && !isPhone() && <Button type="button" variant="text" className={QUIET} onClick={() => open('join-link')}>I have an invite link</Button>
  const link = waiting ? <><Button type="button" variant="text" className={QUIET} disabled={signIn.isPending} onClick={() => signIn.mutate(hint)}>Open Google again</Button><Button type="button" variant="text" className={QUIET} onClick={cancel}>Cancel</Button></> : quiet
  const [title, line] = invited ? [invite?.team ? `You’re invited to ${invite.team}.` : 'You’re invited.', `${invite?.from ? `${firstName(invite.from)} (${invite.from}) invited you. ` : ''}${hint ? `Sign in with Google as ${hint} to join. Everything in the team stays end-to-end encrypted.` : INVITED}`] : [moving ? 'Sign in to keep going.' : TITLE, moving || LINE]
  return <SignInScreen title={title} line={line} hint={hint} ready={ready} busy={busy} disabled={!online || !ready || signIn.isPending} onSignIn={isPhone() ? undefined : () => signIn.mutate(hint)} link={link}>
    {isPhone() && <p className="m-0 text-[13px] text-mute">Sign in to OpenHut on your computer.</p>}
    {waiting && <PasteCode />}
    {online ? <ErrorNote className="max-w-[420px]" message={signIn.error?.message ?? cloud?.signInError ?? undefined} /> : <p className="m-0 text-[13px] text-mute">OpenHut needs the internet the first time.</p>}
  </SignInScreen>
}

export const TITLE = 'Your agents, everywhere.'
export const LINE = 'Private by design. Encrypted on your devices.'

/** The one sign-in screen: the Mac app and app.openhut.dev both render this. */
export function SignInScreen({ title, line, hint, ready = true, busy, busyLabel = 'Finish in your browser', disabled, onSignIn, link, children }: { title: string; line?: ReactNode; hint?: string; ready?: boolean; busy: boolean; busyLabel?: string; disabled: boolean; onSignIn?: () => void; link?: ReactNode; children?: ReactNode }) {
  const action = onSignIn && <Button type="button" variant="primary" className={BIG} disabled={disabled} onClick={onSignIn}><Google size={17} />{hint ? `Sign in as ${hint}` : 'Continue with Google'}</Button>
  const waiting = onSignIn && (busy ? busyLabel : !ready && 'Getting ready…')
  return <EntryScreen title={title} line={line} action={action} waiting={waiting} foot={link}>
    {children}
  </EntryScreen>
}

function PasteCode() {
  const paste = usePasteSignInCode()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim()
    if (code) paste.mutate(code)
  }
  return <form onSubmit={submit} className="flex w-full max-w-[420px] flex-col items-center gap-2">
    <span className="text-[13px] text-mute">Browser didn’t come back? Paste the code from its last page.</span>
    <span className="flex w-full gap-2"><Input name="code" aria-label="Sign-in code" autoComplete="off" spellCheck={false} className="flex-1" /><Button type="submit" variant="secondary" disabled={paste.isPending}>{paste.isPending ? 'Signing in…' : 'Sign in'}</Button></span>
    <ErrorNote message={paste.error?.message} />
  </form>
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

const kitBridge = desktop?.kit
type KitStep = 'save' | 'words' | 'type' | 'copied'
const SECRET = 'Your 12 words and your Google account together open everything. Never share them.'

export function SaveKit({ onBack, onDone }: { onBack?: () => void; onDone: () => void }) {
  const cloud = useCloud().data
  const make = useNewKit()
  const [kit, setKit] = useState<RecoveryKit>()
  const [replaced, setReplaced] = useState(false)
  const [step, setStep] = useState<KitStep>('save')
  const [error, setError] = useState<string>()
  const email = cloud?.email ?? ''
  const old = Boolean(cloud?.kit && !cloud.kit.differs)
  const young = cloud?.youngUntil
  const name = `OpenHut Recovery Kit (${email}).txt`
  const textOf = (made: RecoveryKit) => kitText({ email, madeAt: made.madeAt, device: made.device, kitId: made.kitId, words: made.words })
  const go = (next: KitStep) => {
    setError(undefined)
    setStep(next)
  }
  const saved = (way: KitWay) => {
    if (checksKit(way)) return go('type')
    onDone()
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
      toast('Recovery kit saved', 'In Downloads. Move it to a password manager or USB stick.')
      return saved(download({ name, text }))
    }
    const kept = await kitBridge.save({ name, body: text })
    if (kept.canceled) return
    if (readKit(kept.text ?? '')?.words.join(' ') !== made.words.join(' ')) return setError('The saved file doesn’t match your kit. Save it again.')
    toast('Recovery kit saved', 'Keep the file somewhere safe.')
    saved('file')
  }
  const copy = async () => {
    if (await copySecret(textOf(await ready()))) go('copied')
  }
  const words = async () => {
    await ready()
    go('words')
  }
  if (step === 'words' && kit) return <KitWords kit={kit} replaced={replaced} onBack={isPhone() ? onBack : () => go('save')} onSaved={() => saved('words')} />
  if (step === 'type' && kit) return <ConfirmKit kit={kit} onBack={() => go('words')} onDone={onDone} />
  if (step === 'copied' && kit) return <KitCopied onBack={() => go('save')} onDone={() => saved('copy')} />
  const ways = !young && !isPhone() && <><Button type="button" variant="text" className={QUIET} disabled={make.isPending} onClick={() => run(copy)}>Copy</Button><Button type="button" variant="text" className={QUIET} disabled={make.isPending} onClick={() => run(words)}>Write it down</Button></>
  const label = isPhone() ? 'Show the words' : 'Save kit'
  return <EntryScreen mood="key" title={old && !kit ? 'Save a new recovery kit.' : 'Save your recovery kit.'} line="You only need it if you lose every computer." foot={<>{onBack && <Back onClick={onBack} />}{ways}</>}
    waiting={make.isPending && 'Making your kit…'} action={!young && <Button type="button" variant="primary" className={BIG} onClick={() => run(isPhone() ? words : save)}>{label}</Button>}>
    {!young && <KitCard email={email} />}
    {old && !kit && <p className="m-0 text-mute">{cloud?.passkey ? 'Your old kit and Touch ID will stop working.' : 'Your old kit will stop working.'}</p>}
    {young && <p className="m-0 text-[12.5px] text-mute">This computer was added less than 3 days ago. Make a kit after {shortDate.format(new Date(young))}, or on an older one.</p>}
    <ErrorNote message={error} />
  </EntryScreen>
}

export function Back({ onClick, children = 'Back' }: { onClick: () => void; children?: ReactNode }) {
  return <Button type="button" variant="text" className={QUIET} data-back onClick={onClick}>{children}</Button>
}

function KitCard({ email }: { email: string }) {
  return <div className="flex w-full items-center gap-3 rounded-xl bg-soft px-3.5 py-[13px] text-left">
    <I icon={File01Icon} size={22} className="text-hue-amber" />
    <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-[14px] font-medium text-ink">OpenHut Recovery Kit</span><span className="truncate text-[12.5px] text-mute">12 words · {email}</span></span>
  </div>
}

function numbered(kit: RecoveryKit): string {
  return kit.words.map((word, index) => `${index + 1}. ${word}`).join('\n')
}

function download({ name, text }: { name: string; text: string }): KitWay {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
  return 'file'
}

function KitWords({ kit, replaced, onBack, onSaved }: { kit: RecoveryKit; replaced: boolean; onBack?: () => void; onSaved: () => void }) {
  return <EntryScreen mood="key" title="Write these down." line={replaced ? 'In order. Your old words stop working now. Never share them.' : 'In order. Never share them with anyone.'}
    foot={<>{onBack && <Back onClick={onBack} />}<Button type="button" variant="text" className={QUIET} onClick={() => void copySecret(numbered(kit)).then((ok) => ok && toast('Recovery kit copied', 'Paste it into your password manager. The clipboard clears in a minute.'))}>Copy</Button></>}
    action={<Button type="button" variant="primary" className={BIG} onClick={onSaved}>I wrote them down</Button>}>
    <div className="grid w-full grid-cols-3 gap-1.5 text-left phone:grid-cols-2">{kit.words.map((word, index) => <span key={index} className="flex items-center gap-2 rounded-lg bg-soft px-2.5 py-2 font-mono text-[13px] text-ink"><span className="w-3.5 text-right font-sans text-[11px] text-mute tabular-nums">{index + 1}</span>{word}</span>)}</div>
  </EntryScreen>
}

function KitCopied({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [stored, setStored] = useState(false)
  return <EntryScreen mood="key" title="Paste it somewhere safe." line="Your kit is on the clipboard. OpenHut clears it in a minute." foot={<Back onClick={onBack} />}
    action={<Button type="button" variant="primary" className={BIG} disabled={!stored} onClick={onDone}>Done</Button>}>
    <span className="text-left text-[14px] text-body"><Check checked={stored} onChange={() => setStored(!stored)}>I’ve stored it somewhere safe</Check></span>
    <p className="m-0 text-[12.5px] text-mute">{SECRET}</p>
  </EntryScreen>
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
  return <EntryScreen mood="key" title="Quick check." line="Type two of your words." foot={<Back onClick={onBack} />} action={<Button type="submit" form="check-kit" variant="primary" className={BIG}>Check</Button>}>
    <form id="check-kit" onSubmit={submit} className="flex w-full flex-col gap-3 text-left">
      {kit.ask.map((index, i) => <label key={index} className="flex flex-col gap-1.5"><span className="font-medium">Word {index + 1}</span><Input name={`word-${index}`} className="font-mono" autoComplete="off" spellCheck={false} autoFocus={i === 0} required /></label>)}
      <ErrorNote message={wrong ? 'Those don’t match. Check the word numbers.' : undefined} />
    </form>
  </EntryScreen>
}

function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}

export function TouchIdOffer({ onDone }: { onDone: () => void }) {
  const cloud = useCloud().data
  const add = useAddPasskey()
  const turnOn = () => add.mutate(cloud?.email ?? '', {
    onSuccess: () => {
      notify({ lead: <I icon={FingerPrintIcon} size={18} className="text-hue-green" />, title: 'Touch ID is on' })
      onDone()
    },
    onError: (error) => { if (!(error instanceof PasskeyQuiet)) toastError(error) },
  })
  return <EntryScreen title="Use Touch ID next time?" line="Your next Mac opens with one touch."
    foot={<Button type="button" variant="text" className={QUIET} disabled={add.isPending} onClick={onDone}>Not now</Button>}
    waiting={add.isPending && 'Waiting for Touch ID…'} action={<Button type="button" variant="primary" className={BIG} onClick={turnOn}><I icon={FingerPrintIcon} size={16} />Turn on Touch ID</Button>}>
    <p className="m-0 text-[12.5px]/[18px] text-balance text-mute">Saved in iCloud Keychain. Your Apple Account plus this Google account can open it.</p>
  </EntryScreen>
}
