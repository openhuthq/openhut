import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Analytics01Icon, Globe02Icon, Mail01Icon } from '@hugeicons/core-free-icons'
import * as z from 'zod/mini'
import { InstallSettings, type UpdateInstallSettings } from '@openhut/common/team/team.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { Busy, I, PILL, SetupSheet, Status } from '@/components/kit'
import { Field } from '@/features/connections/sheet'
import { GoogleClientGuide } from '@/features/connections/google-client'
import { Row, Rows } from '@/features/settings/kit'
import { fieldError, formError, request } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { longDate } from '@/lib/format'
import { open } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'

const TestEmail = z.object({ object: z.literal('test_email'), to: z.string() })
const KEY = ['install-settings']
export const ADMIN_STEPS = ['address', 'google-sign-in', 'email']

export function useInstallSettings(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => request({ schema: InstallSettings, path: '/api/install-settings' }), enabled })
}

export function useUpdateInstallSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateInstallSettings) => request({ schema: InstallSettings, path: '/api/install-settings', method: 'PATCH', body }),
    onSuccess: (saved) => client.setQueryData(KEY, saved),
  })
}

function useTestEmail() {
  return useMutation({
    mutationFn: () => request({ schema: TestEmail, path: '/api/install-settings/test-emails', method: 'POST' }),
    onSuccess: ({ to }) => toast('Test email sent', `Check ${to}.`),
    onError: toastError,
  })
}

export function AdminSettings() {
  const settings = useInstallSettings()
  const update = useUpdateInstallSettings()
  const test = useTestEmail()
  const data = settings.data
  if (!data) return <ErrorNote message={settings.error?.message} />
  const until = data.address.certificateUntil
  return <>
    <Group n="01" title="Address" about="People open OpenHut here, and sign-in links and app callbacks come back to it.">
      <Row icon={<I icon={Globe02Icon} size={20} className="text-hue-slate" />} title="HTTPS address" note={<span className="font-mono">{data.address.url ?? 'Not set'}</span>}>
        <Status tone={until ? 'on' : 'off'}>{until ? `Certificate until ${longDate.format(new Date(until))}` : 'No certificate yet'}</Status>
        <Button type="button" variant="secondary" className={PILL} onClick={() => open('address')}>Edit</Button>
      </Row>
    </Group>
    <Group n="02" title="Sign-in" about="Email and password always works, and invited people can always join.">
      <Row icon={<Glyph name="google_sign_in" size={20} />} title="Sign in with Google" note={data.google.signIn ? `Client ${data.google.clientId}` : 'Adds a Google button to sign-in. Uses your own Google OAuth client.'}>
        {data.google.signIn && <Status tone="on">On</Status>}
        {data.google.signIn
          ? <Button type="button" variant="ghost" className={PILL} onClick={() => update.mutate({ googleSignIn: false }, { onError: toastError })}>Turn off</Button>
          : <Button type="button" variant="secondary" className={PILL} onClick={() => open('google-sign-in')}>Set up</Button>}
      </Row>
    </Group>
    <Group n="03" title="Email" about="Sends password reset links. Without it there’s no Forgot password, and you copy invite links yourself.">
      <Row icon={<I icon={Mail01Icon} size={20} className="text-hue-blue" />} title="SMTP server" note={data.smtp.set ? `${data.smtp.host}:${data.smtp.port} · from ${data.smtp.from}` : 'Not set up'}>
        {data.smtp.set && <Button type="button" variant="ghost" className={PILL} disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send test email'}</Button>}
        <Button type="button" variant="secondary" className={PILL} onClick={() => open('email')}>{data.smtp.set ? 'Replace' : 'Set up'}</Button>
      </Row>
    </Group>
    <Group n="04" title="Usage data" about="Once a day: an install id, the version and how many agents. Never names, messages, models or keys.">
      <Row icon={<I icon={Analytics01Icon} size={20} className="text-hue-green" />} title="Share usage data" note="Off unless you turn it on.">
        <Switch checked={data.usageData} aria-label="Share usage data" onCheckedChange={(on) => update.mutate({ usageData: on }, { onError: toastError })} />
      </Row>
    </Group>
  </>
}

function Group({ n, title, about, children }: { n: string; title: string; about: string; children: ReactNode }) {
  return <section className="flex flex-col gap-2">
    <div className="grid gap-0.5 px-2.5">
      <h3 className="m-0 font-mono text-[11.5px] font-medium tracking-[.06em] text-mute uppercase">{n} {title}</h3>
      <p className="m-0 text-[12.5px]/[18px] text-mute">{about}</p>
    </div>
    <Rows>{children}</Rows>
  </section>
}

export function AdminStep({ id }: { id: string }) {
  const settings = useInstallSettings().data
  if (!settings) return <div className="flex-1" />
  if (id === 'address') return <AddressSheet settings={settings} />
  return id === 'email' ? <SmtpSheet settings={settings} /> : <GoogleSignInSheet settings={settings} />
}

function AddressSheet({ settings }: { settings: InstallSettings }) {
  const update = useUpdateInstallSettings()
  const [address, setAddress] = useState(settings.address.url ?? '')
  const close = () => open()
  return <SetupSheet brand="openhut" title="HTTPS address" blurb="Point the name’s DNS at this server first. OpenHut gets and renews its certificate itself, on ports 80 and 443." safe="Everyone signs in again at the new address." onClose={close}
    error={formError(update.error, ['address'])}
    onSubmit={(event) => {
      event.preventDefault()
      const origin = address.trim().replace(/\/+$/, '')
      update.mutate({ address: origin }, { onSuccess: () => { if (URL.canParse(origin) && new URL(origin).origin !== location.origin) location.assign(`${new URL(origin).origin}/login`); else close() } })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{update.isPending ? <Busy label="Saving…" /> : <Button type="submit" variant="primary">Save</Button>}</>}>
    <Field label="Address" error={fieldError(update.error, 'address')}><Input mono type="url" required value={address} onInput={(event) => setAddress(event.currentTarget.value)} placeholder="https://agents.example.com" autoComplete="off" /></Field>
  </SetupSheet>
}

function GoogleSignInSheet({ settings }: { settings: InstallSettings }) {
  const update = useUpdateInstallSettings()
  const close = () => open()
  return <SetupSheet brand="google_sign_in" title="Sign in with Google" blurb="Adds a Google button to sign-in. The Google apps use the same OAuth client." eta="5 minutes" safe="Only people on the team can sign in with Google." onClose={close}
    error={formError(update.error, ['googleClientId', 'googleClientSecret'])}
    onSubmit={(event) => {
      const field = formValues(event)
      const client = settings.google.set ? {} : { googleClientId: field('clientId').trim(), googleClientSecret: field('clientSecret').trim() }
      update.mutate({ ...client, googleSignIn: true }, { onSuccess: close })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{update.isPending ? <Busy label="Saving…" /> : <Button type="submit" variant="primary">Turn on</Button>}</>}>
    {settings.google.set
      ? <p className="m-0 text-[13px]/[18px] text-body">Uses the Google OAuth client already saved ({settings.google.clientId}). Add this redirect URI to it in Google Cloud: <code className="font-mono text-[12px] break-all text-ink">{settings.google.signInRedirectUri}</code></p>
      : <GoogleClientGuide redirectUris={[settings.google.signInRedirectUri, settings.google.connectionsRedirectUri]} error={update.error} />}
  </SetupSheet>
}

function SmtpSheet({ settings }: { settings: InstallSettings }) {
  const update = useUpdateInstallSettings()
  const close = () => open()
  const error = update.error
  const smtp = settings.smtp
  return <SetupSheet brand="smtp" title="SMTP server" blurb="Any mail service works: your provider, Amazon SES, Postmark or Resend. Copy its SMTP details." safe="The password stays on this server." onClose={close}
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
