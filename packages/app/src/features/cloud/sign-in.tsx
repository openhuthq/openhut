import { useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { useCancelSignIn, usePasteSignInCode, useSignIn, useSigningIn } from '@/features/cloud/api'
import { BIG, EntryScreen, QUIET } from '@/features/cloud/step'
import { open, usePath } from '@/lib/router'
import { inviteOf } from '@/features/join/invite'
import { firstName } from '@/features/cloud/live'

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

function Google({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} aria-hidden="true"><use href="#lg-google" width="100%" height="100%" /></svg>
}
