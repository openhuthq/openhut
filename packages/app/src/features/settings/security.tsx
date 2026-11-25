import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Analytics01Icon, Mail01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import { SecuritySettings, type UpdateSecurity } from '@openhut/common/team/team.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Busy, I, PILL, Section, SetupSheet, Status } from '@/components/kit'
import { Field } from '@/features/connections/sheet'
import { GoogleClientGuide } from '@/features/connections/google-client'
import { useIsAdmin } from '@/features/people/api'
import { ListNote, Row, Rows } from '@/features/settings/kit'
import { fieldError, formError, request } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { open } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'

const TestEmail = z.object({ object: z.literal('test_email'), to: z.string() })
const KEY = ['settings', 'security']
export const SECURITY_STEPS = ['google-sign-in', 'email']

export function useSecurity() {
  return useQuery({ queryKey: KEY, queryFn: () => request({ schema: SecuritySettings, path: '/api/settings/security' }) })
}

export function useUpdateSecurity() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateSecurity) => request({ schema: SecuritySettings, path: '/api/settings/security', method: 'PATCH', body }),
    onSuccess: (saved) => client.setQueryData(KEY, saved),
  })
}

function useTestEmail() {
  return useMutation({
    mutationFn: () => request({ schema: TestEmail, path: '/api/settings/security/test-emails', method: 'POST' }),
    onSuccess: ({ to }) => toast('Test email sent', `Check ${to}.`),
    onError: toastError,
  })
}

export function SecuritySettingsTab() {
  const settings = useSecurity()
  const update = useUpdateSecurity()
  const test = useTestEmail()
  const admin = useIsAdmin()
  const data = settings.data
  if (!data) return <ErrorNote message={settings.error?.message} />
  return <>
    <Section title="Sign-in">
      <Rows>
        <Row icon={<I icon={SquareLock02Icon} size={20} className="text-hue-slate" />} title="Email and password" note="Everyone signs in with their email. Always on."><Status tone="on">On</Status></Row>
        <Row icon={<Glyph name="google_sign_in" size={20} />} title="Sign in with Google" note={data.google.signIn ? `Client ${data.google.clientId}` : 'Off. Uses your own Google OAuth client.'}>
          {data.google.signIn
            ? <><Status tone="on">On</Status>{admin && <Button type="button" variant="ghost" className={PILL} onClick={() => update.mutate({ googleSignIn: false }, { onError: toastError })}>Turn off</Button>}</>
            : admin && <Button type="button" variant="secondary" className={PILL} onClick={() => open('google-sign-in')}>Set up</Button>}
        </Row>
      </Rows>
    </Section>
    <Section title="Email">
      <ListNote>Optional. Without it, you copy invite links yourself and there’s no Forgot password.</ListNote>
      <Rows>
        <Row icon={<I icon={Mail01Icon} size={20} className="text-hue-blue" />} title="Email (SMTP)" note={data.smtp.set ? `${data.smtp.host}:${data.smtp.port} · from ${data.smtp.from}` : 'Not set up. Sends password resets.'}>
          {admin && data.smtp.set && <Button type="button" variant="secondary" className={PILL} disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send test email'}</Button>}
          {admin && <Button type="button" variant={data.smtp.set ? 'ghost' : 'secondary'} className={PILL} onClick={() => open('email')}>{data.smtp.set ? 'Edit' : 'Set up'}</Button>}
        </Row>
      </Rows>
    </Section>
    <Section title="Usage data">
      <Rows>
        <Row icon={<I icon={Analytics01Icon} size={20} className="text-hue-green" />} title="Share anonymous usage data" note="Once a day: an install id, the version and how many agents. Never names, messages, models or keys.">
          <Switch checked={data.usageData} disabled={!admin} aria-label="Share anonymous usage data" onCheckedChange={(on) => update.mutate({ usageData: on }, { onError: toastError })} />
        </Row>
      </Rows>
    </Section>
  </>
}

export function SecurityStep({ id }: { id: string }) {
  const settings = useSecurity().data
  if (!settings) return <div className="flex-1" />
  return id === 'email' ? <SmtpSheet settings={settings} /> : <GoogleSignInSheet settings={settings} />
}

function GoogleSignInSheet({ settings }: { settings: SecuritySettings }) {
  const update = useUpdateSecurity()
  const close = () => open()
  return <SetupSheet brand="google_sign_in" title="Sign in with Google" blurb="Let your team sign in with their Google accounts. Bring your own OAuth client; the Google apps use the same one." eta="5 minutes" safe="Email and password keep working. Only people on the team can sign in." onClose={close}
    error={formError(update.error, ['googleClientId', 'googleClientSecret'])}
    onSubmit={(event) => {
      const field = formValues(event)
      const client = settings.google.set ? {} : { googleClientId: field('clientId').trim(), googleClientSecret: field('clientSecret').trim() }
      update.mutate({ ...client, googleSignIn: true }, { onSuccess: close })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{update.isPending ? <Busy label="Saving…" /> : <Button type="submit" variant="primary">Turn on</Button>}</>}>
    {settings.google.set
      ? <p className="m-0 text-[13px]/[18px] text-body">Uses the Google OAuth client already saved ({settings.google.clientId}). Add this redirect URL to it in Google Cloud: <code className="font-mono text-[12px] break-all text-ink">{settings.google.signInRedirectUri}</code></p>
      : <GoogleClientGuide redirectUris={[settings.google.signInRedirectUri, settings.google.connectionsRedirectUri]} error={update.error} />}
  </SetupSheet>
}

function SmtpSheet({ settings }: { settings: SecuritySettings }) {
  const update = useUpdateSecurity()
  const close = () => open()
  const error = update.error
  const smtp = settings.smtp
  return <SetupSheet brand="smtp" title="Email (SMTP)" blurb="Use any mail service: your provider, Amazon SES, Postmark or Resend. Copy the SMTP details from it." safe="The password stays on this server." onClose={close}
    error={formError(error, ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPassword', 'smtpFrom'])}
    onSubmit={(event) => {
      const field = formValues(event)
      update.mutate({ smtpHost: field('smtpHost').trim(), smtpPort: Number(field('smtpPort') || 587), smtpUser: field('smtpUser').trim(), smtpPassword: field('smtpPassword'), smtpFrom: field('smtpFrom').trim() }, { onSuccess: close })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{update.isPending ? <Busy label="Saving…" /> : <Button type="submit" variant="primary">Save</Button>}</>}>
    <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2.5">
      <Field label="Host" error={fieldError(error, 'smtpHost')}><Input mono name="smtpHost" required defaultValue={smtp.host ?? ''} placeholder="smtp.example.com" autoComplete="off" /></Field>
      <Field label="Port" error={fieldError(error, 'smtpPort')}><Input mono name="smtpPort" defaultValue={String(smtp.port ?? 587)} inputMode="numeric" autoComplete="off" /></Field>
      <Field label="Username"><Input mono name="smtpUser" defaultValue={smtp.user ?? ''} placeholder="apikey" autoComplete="off" /></Field>
      <span />
      <Field label="Password"><Input mono name="smtpPassword" type="password" placeholder={smtp.set ? 'Unchanged' : '••••••••'} autoComplete="off" /></Field>
      <span />
      <Field label="From address" error={fieldError(error, 'smtpFrom')}><Input name="smtpFrom" type="email" required defaultValue={smtp.from ?? ''} placeholder="openhut@example.com" autoComplete="off" /></Field>
    </div>
  </SetupSheet>
}
