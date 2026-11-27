import { useState } from 'react'
import { GOOGLE_KINDS, SIGN_IN_KINDS } from '@openhut/common/connections/connection.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { openSignInTab, useAuthorizeConnection, useCreateConnection } from '@/features/connections/api'
import { useConnections } from '@/lib/queries/connections'
import { uniqueName, type Integration } from '@/config/catalog'
import { Field } from '@/components/sheet'
import { GoogleClientGuide } from '@/components/google-client-guide'
import { useInstallSettings, useUpdateInstallSettings } from '@/lib/queries/install-settings'
import { useIsAdmin } from '@/lib/queries/people'
import { useAskForGithub, useGithubApp, useGithubSetup } from '@/features/connections/github-app'
import { connectStep } from '@/features/connections/github-setup'
import { CopyButton } from '@/components/copy-button'
import { Busy, PILL, SetupSheet } from '@/components/kit'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROLE_SQL = `create role openhut_reader login password 'choose-a-password';
grant pg_read_all_data to openhut_reader;`

type FlowProps = { me: Me; item: Integration; close: () => void; returned: string | undefined }

export function ConnectSheet({ me, item, onClose }: { me: Me; item: Integration; onClose?: () => void }) {
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  const close = onClose ?? (() => navigate('/connections'))
  const props = { me, item, returned, close }
  if (GOOGLE_KINDS.some((kind) => kind === item.name)) return <GoogleSheet {...props} />
  switch (item.name) {
    case 'postgres': return <PostgresSheet {...props} />
    case 'convex': return <ConvexSheet {...props} />
    case 'mcp': return <McpSheet {...props} />
    case 'github': return <GitHubSheet {...props} />
    default: return <QuickSheet {...props} />
  }
}

function sheetOf(item: Integration) {
  return { brand: item.name, title: `Connect ${item.title}`, blurb: item.short }
}

const FOOT = (close: () => void, busy: boolean, label: string) => <><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{busy ? <Busy label="Connecting…" /> : <Button type="submit" variant="primary">{label}</Button>}</>

function PostgresSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const [mode, setMode] = useState('dsn')
  const name = useNameField(item)
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(create.error, ['dsn', 'name']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      const dsn = mode === 'dsn' ? field('dsn') : `postgres://${encodeURIComponent(field('user'))}:${encodeURIComponent(field('password'))}@${field('host')}:${field('port') || '5432'}/${encodeURIComponent(field('database'))}`
      create.mutate({ kind: 'postgres', name: field('name').trim(), dsn })
    }}
    foot={FOOT(close, create.isPending, 'Test and connect')}>
    {name(fieldError(create.error, 'name'))}
    <ToggleGroup variant="segmented" aria-label="How to enter it" className="w-fit" value={mode} onPick={setMode}>
      <ToggleGroupItem className="text-[13px]" value="dsn">Connection string</ToggleGroupItem>
      <ToggleGroupItem className="text-[13px]" value="fields">Host and port</ToggleGroupItem>
    </ToggleGroup>
    {mode === 'dsn'
      ? <Field label="Connection string" error={fieldError(create.error, 'dsn')}><Input mono name="dsn" required placeholder="postgres://openhut_reader:…@host:5432/db" autoComplete="off" /></Field>
      : <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2.5">
        <Field label="Host"><Input mono name="host" required placeholder="db.acme.internal" autoComplete="off" /></Field>
        <Field label="Port"><Input mono name="port" defaultValue="5432" inputMode="numeric" autoComplete="off" /></Field>
        <Field label="Database"><Input mono name="database" required placeholder="billing" autoComplete="off" /></Field>
        <span />
        <Field label="User"><Input mono name="user" required defaultValue="openhut_reader" autoComplete="off" /></Field>
        <span />
        <Field label="Password"><Input mono name="password" type="password" required placeholder="••••••••" autoComplete="off" /></Field>
      </div>}
    <span className="flex items-center gap-2 text-[12px] text-mute">Use a read-only role.<CopyButton text={ROLE_SQL} label="Copy SQL" className={PILL} /></span>
  </SetupSheet>
}

function ConvexSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const name = useNameField(item)
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(create.error, ['deployKey', 'name']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      create.mutate({ kind: 'convex', name: field('name').trim(), deployKey: field('deployKey') })
    }}
    foot={FOOT(close, create.isPending, 'Test and connect')}>
    {name(fieldError(create.error, 'name'))}
    <Field label="Deploy key" error={fieldError(create.error, 'deployKey')}><Input mono name="deployKey" type="password" required placeholder="prod:happy-otter-123|eyJ…" autoComplete="off" /></Field>
    <span className="flex items-center gap-2 text-[12px] text-mute">From Settings › Deploy keys. Convex’s official MCP server runs on this computer with it.<a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href="https://dashboard.convex.dev" target="_blank" rel="noreferrer">Open Convex</a></span>
  </SetupSheet>
}

function McpSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const authorize = useAuthorizeConnection()
  const [auth, setAuth] = useState('header')
  const name = useNameField(item)
  const error = create.error ?? authorize.error
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(error, ['url', 'header', 'name']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      const server = { name: field('name').trim(), url: field('url') }
      if (auth === 'oauth') return authorize.mutate({ kind: 'mcp', ...server, tab: openSignInTab() })
      create.mutate({ kind: 'mcp', ...server, header: auth === 'header' ? `${field('headerName')}: ${field('headerValue')}` : undefined })
    }}
    foot={FOOT(close, create.isPending || authorize.isPending, 'Connect')}>
    {name(fieldError(error, 'name'))}
    <Field label="URL" error={fieldError(error, 'url')}><Input mono name="url" type="url" required placeholder="https://mcp.example.com/mcp" autoComplete="off" /></Field>
    <ToggleGroup variant="segmented" aria-label="How it signs in" className="w-fit" value={auth} onPick={setAuth}>
      <ToggleGroupItem className="text-[13px]" value="none">Public</ToggleGroupItem>
      <ToggleGroupItem className="text-[13px]" value="header">Header</ToggleGroupItem>
      <ToggleGroupItem className="text-[13px]" value="oauth">Sign in</ToggleGroupItem>
    </ToggleGroup>
    {auth === 'header' && <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-2.5">
      <Field label="Header" error={fieldError(error, 'header')}><Input mono name="headerName" defaultValue="Authorization" autoComplete="off" /></Field>
      <Field label="Value"><Input mono name="headerValue" type="password" placeholder="Bearer …" autoComplete="off" /></Field>
    </div>}
  </SetupSheet>
}

function GoogleSheet(props: FlowProps) {
  const { item, close, returned } = props
  const admin = useIsAdmin()
  const settings = useInstallSettings(admin)
  const google = settings.data?.google
  const save = useUpdateInstallSettings()
  const quick = useQuickConnect()
  if (!admin || google?.set) return <QuickSheet {...props} />
  if (!google) return null
  return <SetupSheet {...sheetOf(item)} blurb="Google needs your own OAuth client first. An admin sets it up once and the whole team uses it." eta="5 minutes" onClose={close}
    error={formError(save.error, ['googleClientId', 'googleClientSecret']) ?? returned} safe="The secret stays on this server."
    onSubmit={(event) => {
      const field = formValues(event)
      const tab = openSignInTab()
      save.mutate({ googleClientId: field('clientId').trim(), googleClientSecret: field('clientSecret').trim() }, { onSuccess: () => quick.connect(item, tab), onError: () => tab?.close() })
    }}
    foot={FOOT(close, save.isPending || quick.pending, 'Save and connect')}>
    <GoogleClientGuide redirectUris={[google.connectionsRedirectUri, google.signInRedirectUri]} error={save.error} apis />
  </SetupSheet>
}

function GitHubSheet(props: FlowProps) {
  const { item, close } = props
  const admin = useIsAdmin()
  const info = useGithubApp().data
  const askAdmin = useAskForGithub()
  const [ready, setReady] = useState(false)
  const setup = useGithubSetup({ onClose: close, onDone: () => setReady(true) })
  if (!info) return null
  const step = connectStep({ admin, app: !!info.app, started: setup.started, ready })
  if (step === 'setup') return <SetupSheet {...sheetOf(item)} onClose={close} {...setup.sheet} />
  if (step === 'connect') return <QuickSheet {...props} />
  return <SetupSheet {...sheetOf(item)} blurb="An admin sets GitHub up once for your team." onClose={close}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      {info.asked ? <span className="inline-flex h-8 items-center gap-1.5 px-1 text-[13px] text-mute"><i className="size-1.5 rounded-full bg-amber" />Asked. Waiting for an admin to set up GitHub</span>
        : <Button type="button" variant="primary" disabled={askAdmin.isPending} onClick={() => askAdmin.mutate(undefined)}>Ask an admin</Button>}</>} />
}

function QuickSheet({ item, close, returned }: FlowProps) {
  const quick = useQuickConnect()
  const again = quick.error || returned ? 'Try again' : 'Connect'
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(quick.error, []) ?? returned}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      <Button type="button" variant="primary" disabled={quick.pending} onClick={() => quick.connect(item)}>{quick.pending ? 'Connecting…' : again}</Button></>} />
}

export function useQuickConnect() {
  const authorize = useAuthorizeConnection()
  const create = useCreateConnection()
  const taken = (useConnections().data ?? []).map((connection) => connection.name)
  const github = !!useGithubApp().data?.app
  const direct = (item: Integration) => (item.name === 'github' ? github : QUICK.has(item.name)) || GOOGLE_KINDS.some((kind) => kind === item.name)
  const connect = (item: Integration, opened?: Window | null) => {
    const name = uniqueName({ title: item.title, taken })
    if (item.name === 'excalidraw') return create.mutate({ kind: 'excalidraw', name }, { onError: toastError })
    const tab = opened === undefined ? openSignInTab() : opened
    const kind = SIGN_IN_KINDS.find((each) => each === item.name)
    if (kind) authorize.mutate({ kind, name, tab }, { onError: toastError })
  }
  return { direct, connect, pending: authorize.isPending || create.isPending, error: authorize.error ?? create.error }
}

const QUICK = new Set(['posthog', 'linear', 'github', 'excalidraw'])

function useNameField(item: Integration) {
  const taken = (useConnections().data ?? []).map((connection) => connection.name)
  return (error: string | undefined) => <Field label="Name" error={error}><Input name="name" required defaultValue={uniqueName({ title: item.title, taken })} maxLength={60} autoComplete="off" /></Field>
}
