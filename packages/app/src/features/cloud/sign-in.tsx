import { useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Mail01Icon } from '@hugeicons/core-free-icons'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { useCancelSignIn, usePasteSignInCode, useSignIn, useSigningIn } from '@/features/cloud/api'
import { BIG, EntryScreen, QUIET } from '@/features/cloud/step'
import { open, usePath } from '@/lib/router'
import { inviteOf } from '@/features/join/invite'
import { firstName } from '@/features/cloud/live'
import { remote } from '@/lib/remote'
import { toast } from '@/lib/toast'

const INVITED = 'Sign in with the email your invite went to.'

export function SignIn({ cloud }: { cloud: Cloud | undefined }) {
  const signIn = useSignIn()
  const waiting = useSigningIn()
  const cancel = useCancelSignIn()
  const online = useOnline()
  const invited = usePath() === '/join'
  const invite = invited ? inviteOf(location.hash) : undefined
  const hint = invite?.email
  const busy = waiting || signIn.isPending
  const ready = Boolean(cloud)
  const quiet = !invited && <Button type="button" variant="text" className={QUIET} onClick={() => open('join-link')}>I have an invite link</Button>
  const link = waiting ? <><Button type="button" variant="text" className={QUIET} disabled={signIn.isPending} onClick={() => signIn.mutate(hint)}>Open Google again</Button><Button type="button" variant="text" className={QUIET} onClick={cancel}>Cancel</Button></> : quiet
  const [title, line] = invited ? [invite?.team ? `You’re invited to ${invite.team}.` : 'You’re invited.', `${invite?.from ? `${firstName(invite.from)} (${invite.from}) invited you. ` : ''}${hint ? `Sign in with Google as ${hint} to join.` : INVITED}`] : [TITLE, LINE]
  return <SignInScreen title={title} line={line} hint={hint} ready={ready} busy={busy} disabled={!online || !ready || signIn.isPending} onSignIn={() => signIn.mutate(hint)} link={link}>
    {waiting && <PasteCode />}
    {online ? <ErrorNote className="max-w-[420px]" message={signIn.error?.message ?? cloud?.signInError ?? undefined} /> : <p className="m-0 text-[13px] text-mute">OpenHut needs the internet the first time.</p>}
  </SignInScreen>
}

export const TITLE = 'Your agents, everywhere.'
export const LINE = 'On Cloud or your own server.'

/** The one sign-in screen. */
export function SignInScreen({ title, line, hint, ready = true, busy, busyLabel = 'Finish in your browser', disabled, onSignIn, more, link, children }: { title: string; line?: ReactNode; hint?: string; ready?: boolean; busy: boolean; busyLabel?: string; disabled: boolean; onSignIn?: () => void; more?: ReactNode; link?: ReactNode; children?: ReactNode }) {
  const action = onSignIn && <><Button type="button" variant="primary" className={BIG} disabled={disabled} onClick={onSignIn}><Google size={17} />{hint ? `Sign in as ${hint}` : 'Continue with Google'}</Button>{more}</>
  const waiting = onSignIn && (busy ? busyLabel : !ready && 'Getting ready…')
  return <EntryScreen title={title} line={line} action={action} waiting={waiting} foot={link}>
    {children}
  </EntryScreen>
}

const SECOND = 'h-[38px] w-full justify-center gap-2 rounded-[10px] text-[14px]'

/** Under Continue with Google: email a sign-in code. */
export function EmailCodeStart({ onSent }: { onSent: (email: string) => void }) {
  const send = useMutation({ mutationFn: remote.sendCode, onSuccess: onSent })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    if (email) send.mutate(email)
  }
  return <form onSubmit={submit} className="flex w-full flex-col items-center gap-3.5">
    <span className="flex w-full items-center gap-2.5 text-[12px] text-mute before:h-px before:flex-1 before:bg-hair after:h-px after:flex-1 after:bg-hair">or</span>
    <Input name="email" type="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email" className="w-full" />
    <Button type="submit" variant="secondary" className={SECOND} disabled={send.isPending}><I icon={Mail01Icon} size={15} />{send.isPending ? 'Sending…' : 'Email me a code'}</Button>
    <ErrorNote message={send.error?.message} />
  </form>
}

/** After the code went out: type it to sign in. */
export function EmailCodeEntry({ email, onSignedIn, onBack }: { email: string; onSignedIn: () => void; onBack: () => void }) {
  const signIn = useMutation({ mutationFn: (code: string) => remote.signInWithCode({ email, code }), onSuccess: onSignedIn })
  const resend = useMutation({ mutationFn: () => remote.sendCode(email), onSuccess: () => toast('New code sent') })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    signIn.mutate(String(new FormData(event.currentTarget).get('code') ?? '').trim())
  }
  return <EntryScreen title="Check your email." line={`We sent a 6-digit code to ${email}. It works for 5 minutes.`}
    action={<Button type="submit" form="email-code" variant="primary" className={BIG} disabled={signIn.isPending}>{signIn.isPending ? 'Signing in…' : 'Sign in'}</Button>}
    foot={<><Button type="button" variant="text" className={QUIET} disabled={resend.isPending} onClick={() => resend.mutate()}>Send a new code</Button><Button type="button" variant="text" className={QUIET} onClick={onBack}>Use another email</Button></>}>
    <form id="email-code" onSubmit={submit} className="w-full">
      <Input name="code" aria-label="6-digit code" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} spellCheck={false} className="h-12 w-full text-center font-mono text-[24px] tracking-[.5em] tabular-nums" />
    </form>
    <ErrorNote message={(signIn.error ?? resend.error)?.message} />
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

export function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
