import { useState } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { useCreatePerson, useCreateSession, useFinishReset, useInviteLink, useSetup, useStartReset } from '@/features/auth/api'
import { AuthForm, BIG, EntryScreen } from '@/features/auth/entry'
import { CredentialFields } from '@/features/auth/credential-fields'
import { fieldError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { Redirect } from '@/lib/router'

const query = (name: string) => new URLSearchParams(location.search).get(name) ?? ''
const QUIET = 'h-auto text-[13px] font-normal text-mute'

export function SetupPage() {
  const setup = useSetup()
  const createPerson = useCreatePerson()
  // The app sends a signed-out visitor on to /login ("Welcome back"); a signed-in one stays.
  if (setup.data?.open === false) return <Redirect to="/" />
  return <AuthForm title="Create your account" line="You’re first here, so this is the owner account." error={createPerson.error}
    fields={['address', 'email', 'password']} busy={createPerson.isPending} button="Create account" foot="After this, people join by invite link."
    onSubmit={(event) => {
      const field = formValues(event)
      const address = field('address').trim().replace(/\/+$/, '')
      void createPerson.mutateAsync({ address, email: field('email'), password: field('password') }).then(() => {
        if (URL.canParse(address) && new URL(address).origin !== location.origin) location.assign(`${new URL(address).origin}/login`)
      }, () => undefined)
    }}>
    <Field strong label="Address" hint="The HTTPS address your team will open. Point its DNS at this server first; OpenHut gets the certificate itself." error={fieldError(createPerson.error, 'address')}>{(control) =>
      <Input variant="lg" {...control} name="address" type="url" required defaultValue={location.protocol === 'https:' ? location.origin : ''} placeholder="https://agents.example.com" autoComplete="url" />}</Field>
    <CredentialFields error={createPerson.error} />
  </AuthForm>
}

export function SignInPage() {
  const setup = useSetup().data
  const createSession = useCreateSession()
  const [forgot, setForgot] = useState(false)
  if (setup?.open) return <Redirect to={`/setup${location.search}`} />
  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />
  return <AuthForm title="Welcome back" line="Sign in to OpenHut." error={query('error') === 'google' && !createSession.error ? new Error('That Google account can’t sign in here. Use one on the team, or your email and password.') : createSession.error}
    fields={['email', 'password']} busy={createSession.isPending} button="Sign in"
    foot={<span>No account? Ask the owner for an invite.{setup?.passwordReset && <> · <Button type="button" variant="text" className={QUIET} onClick={() => setForgot(true)}>Forgot password</Button></>}</span>}
    onSubmit={(event) => {
      const field = formValues(event)
      createSession.mutate({ email: field('email'), password: field('password') })
    }}>
    <Field strong label="Email" error={fieldError(createSession.error, 'email')}>{(control) => <Input variant="lg" {...control} name="email" type="email" required autoComplete="email" placeholder="you@company.com" />}</Field>
    <Field strong label="Password" error={fieldError(createSession.error, 'password')}>{(control) => <Input variant="lg" {...control} name="password" type="password" required autoComplete="current-password" />}</Field>
    {setup?.googleSignIn && <a href="/api/google-sign-in" className={`${BIG} inline-flex items-center rounded-[10px] border border-hair text-ink no-underline hover:bg-hover`}><Glyph name="google_sign_in" size={16} />Sign in with Google</a>}
  </AuthForm>
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const start = useStartReset()
  if (start.isSuccess) return <EntryScreen title="Check your email" line="If that email is on the team, a link to pick a new password is on its way. It works for an hour." foot={<Button type="button" variant="text" className={QUIET} onClick={onBack}>Back to sign in</Button>} />
  return <AuthForm title="Forgot password" line="We’ll email you a link to pick a new one." error={start.error} fields={['email']} busy={start.isPending} button="Send link"
    foot={<Button type="button" variant="text" className={QUIET} onClick={onBack}>Back to sign in</Button>}
    onSubmit={(event) => start.mutate({ email: formValues(event)('email') })}>
    <Field strong label="Email" error={fieldError(start.error, 'email')}>{(control) => <Input variant="lg" {...control} name="email" type="email" required autoComplete="email" placeholder="you@company.com" />}</Field>
  </AuthForm>
}

export function ResetPage() {
  const finish = useFinishReset()
  return <AuthForm title="Pick a new password" line="You’ll be signed in, and signed out everywhere else." error={finish.error} fields={['password']} busy={finish.isPending} button="Save password"
    onSubmit={(event) => finish.mutate({ token: query('token'), password: formValues(event)('password') })}>
    <Field strong label="New password" hint="12 or more characters." error={fieldError(finish.error, 'password')}>{(control) => <Input variant="lg" {...control} name="password" type="password" required autoComplete="new-password" />}</Field>
  </AuthForm>
}

export function InvitePage({ token }: { token: string }) {
  const invite = useInviteLink(token)
  const createPerson = useCreatePerson()
  if (invite.error) return <EntryScreen title="This link doesn’t work" line={invite.error.message} foot={<a className={QUIET} href="/login">Sign in</a>} />
  if (!invite.data) return <EntryScreen title="Join your team" />
  return <AuthForm title="Join your team" line={`You’re invited as ${invite.data.role === 'admin' ? 'an admin' : 'a member'}. Pick your name and password.`} error={createPerson.error}
    fields={['name', 'email', 'password']} busy={createPerson.isPending} button="Join"
    foot={<span>Have an account? <a className={QUIET} href="/login">Sign in</a></span>}
    onSubmit={(event) => {
      const field = formValues(event)
      createPerson.mutate({ inviteToken: token, name: field('name'), email: field('email'), password: field('password') })
    }}>
    <Field strong label="Your name" error={fieldError(createPerson.error, 'name')}>{(control) => <Input variant="lg" {...control} name="name" required autoComplete="name" maxLength={80} placeholder="Sam Lee" />}</Field>
    <CredentialFields error={createPerson.error} />
  </AuthForm>
}
