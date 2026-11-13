import type { Me } from '@fastmonkey/common/team/team.ts'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { Choices, SetupDialog, SetupFoot, SetupStep, SetupSteps, SetupSubmit, type SetupInfo } from '@/components/setup'
import { useAdmin } from '@/features/admin/api'
import { useAuthorizeConnection, useConnectTailscale, useCreateConnection } from '@/features/connections/api'
import type { Integration } from '@/features/connections/catalog'
import { GoogleClientSetup } from '@/features/connections/google-client-setup'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

const ROLE_SQL = `create role fastmonkey_reader login password 'choose-a-password';
grant pg_read_all_data to fastmonkey_reader;`

function GithubFlow({ item, info, close, returned }: FlowProps) {
  const authorize = useAuthorizeConnection()
  return <form id="connect-main" onSubmit={(event) => {
    const field = formValues(event)
    authorize.mutate({ kind: 'github', name: field('name'), organization: field('organization') || undefined })
  }}>
    <SetupSteps>
      <SetupStep n={1} title="Name the bot" state="now">
        <Field label="Bot name" error={fieldError(authorize.error, 'name')}>{(control) =>
          <input {...control} name="name" placeholder="acme-monkey" required maxLength={34} autoComplete="off" autoFocus />}</Field>
        <Field label="Organization" error={fieldError(authorize.error, 'organization')}>{(control) =>
          <input {...control} name="organization" placeholder="Empty for your own account" pattern="[A-Za-z0-9\-]{1,39}" title="The organization as it appears in its GitHub URL." autoComplete="off" />}</Field>
        <p className="hint">Commits and pull requests show as name[bot]. The name must be free on GitHub.</p>
      </SetupStep>
      <SetupStep n={2} title="Create it on GitHub" tag="one click" />
      <SetupStep n={3} title="Pick its repositories" tag="on GitHub" />
    </SetupSteps>
    <SetupFoot info={info} cancel={close} error={formError(authorize.error, ['name', 'organization']) ?? returned}>
      <SetupSubmit brand={item.name} pending={authorize.isPending} label="Create the bot on GitHub" busy="Opening GitHub…" />
    </SetupFoot>
  </form>
}

export function ConnectDialog({ me, item }: { me: Me; item: Integration }) {
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  const info: SetupInfo = { brand: item.name, title: `Connect ${item.title}`, blurb: item.short, chips: item.chips, safe: item.safeLine, warn: item.warn, eta: item.eta, details: item.safe }
  return <SetupDialog info={info} onClosed={() => navigate('/connections')}>{(close) => <Flow me={me} item={item} info={info} close={close} returned={returned} />}</SetupDialog>
}

function Flow(props: FlowProps & { me: Me }) {
  switch (props.item.name) {
    case 'postgres': return <PostgresFlow {...props} />
    case 'convex': return <ConvexFlow {...props} />
    case 'github': return <GithubFlow {...props} />
    case 'posthog':
    case 'linear': return <SignInFlow {...props} />
    case 'gmail':
    case 'drive':
    case 'google': return <GoogleFlow {...props} />
    case 'tailscale': return <TailscaleFlow {...props} />
    case 'mcp': return <McpFlow {...props} />
  }
}

function PostgresFlow({ item, info, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  return <form id="connect-main" onSubmit={(event) => {
    const dsn = formValues(event)('dsn')
    createConnection.mutate({ kind: 'postgres', name: nameFromUrl(dsn, item.title), dsn })
  }}>
    <SetupSteps>
      <SetupStep n={1} title="Make a read-only role" state="now">
        <pre className="snippet">{ROLE_SQL}</pre>
        <div><CopyButton text={ROLE_SQL} label="Copy SQL" /></div>
      </SetupStep>
      <SetupStep n={2} title="Paste its connection string">
        <Field label="Connection string" error={fieldError(createConnection.error, 'dsn')}>{(control) =>
          <input {...control} name="dsn" className="mono" placeholder="postgres://fastmonkey_reader:…@host:5432/db" required autoComplete="off" />}</Field>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={close} error={formError(createConnection.error, ['dsn']) ?? returned}>
      <SetupSubmit pending={createConnection.isPending} label="Test and connect" busy="Testing…" />
    </SetupFoot>
  </form>
}

function ConvexFlow({ item, info, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  return <form id="connect-main" onSubmit={(event) => {
    const deployKey = formValues(event)('deployKey')
    createConnection.mutate({ kind: 'convex', name: /^\w+:([\w-]+)\|/.exec(deployKey)?.[1] ?? item.title, deployKey })
  }}>
    <SetupSteps>
      <SetupStep n={1} title="Copy a deploy key" state="now">
        <div><a className="btn sec sm" href="https://dashboard.convex.dev" target="_blank" rel="noreferrer">{ICONS.ext}Open Convex, then Settings › Deploy keys</a></div>
      </SetupStep>
      <SetupStep n={2} title="Paste it">
        <Field label="Deploy key" error={fieldError(createConnection.error, 'deployKey')}>{(control) =>
          <input {...control} name="deployKey" type="password" className="mono" placeholder="prod:happy-otter-123|eyJ…" required autoComplete="off" />}</Field>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={close} error={formError(createConnection.error, ['deployKey']) ?? returned}>
      <SetupSubmit pending={createConnection.isPending} label="Test and connect" busy="Testing…" />
    </SetupFoot>
  </form>
}

function SignInFlow({ item, info, close, returned }: FlowProps) {
  const authorize = useAuthorizeConnection()
  const kind = item.name === 'posthog' ? 'posthog' : 'linear'
  return <form id="connect-main" onSubmit={(event) => { event.preventDefault(); authorize.mutate({ kind, name: item.title }) }}>
    <SetupFoot info={info} cancel={close} error={formError(authorize.error, []) ?? returned}>
      <SetupSubmit brand={item.name} pending={authorize.isPending} label={`Sign in with ${item.title}`} busy={`Opening ${item.title}…`} />
    </SetupFoot>
  </form>
}

function GoogleFlow({ me, item, info, close, returned }: FlowProps & { me: Me }) {
  const admin = useAdmin()
  const authorize = useAuthorizeConnection()
  const kind = item.name === 'gmail' || item.name === 'drive' ? item.name : 'google'
  if (!admin.data) return <SetupSteps><ErrorNote message={admin.error?.message} /></SetupSteps>
  const ready = !!admin.data.google.clientId
  return <>
    {!ready && <SetupSteps>
      <SetupStep n={1} title="Set up Google once" state="now" tag="once per server">
        {me.user.role === 'member' ? <p className="mute">An owner or admin does this once, in Admin.</p> : <GoogleClientSetup admin={admin.data} back={location.pathname} />}
      </SetupStep>
      <SetupStep n={2} title="Sign in with Google" />
    </SetupSteps>}
    <form id="connect-main" onSubmit={(event) => { event.preventDefault(); authorize.mutate({ kind, name: item.title }) }}>
      <SetupFoot info={info} cancel={close} error={formError(authorize.error, []) ?? returned}>
        <SetupSubmit brand="google" pending={authorize.isPending} disabled={!ready} label="Sign in with Google" busy="Opening Google…" />
      </SetupFoot>
    </form>
  </>
}

function McpFlow({ item, info, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  const authorize = useAuthorizeConnection()
  const error = createConnection.error ?? authorize.error
  return <form id="connect-main" className="mcpform" onSubmit={(event) => {
    const field = formValues(event)
    const server = { name: nameFromUrl(field('url'), item.title), url: field('url') }
    if (field('auth') === 'oauth') return authorize.mutate({ kind: 'mcp', ...server })
    createConnection.mutate({ kind: 'mcp', ...server, header: field('auth') === 'header' ? `${field('headerName')}: ${field('headerValue')}` : undefined })
  }}>
    <SetupSteps>
      <SetupStep n={1} title="Server URL" state="now">
        <Field label="URL" error={fieldError(error, 'url')}>{(control) =>
          <input {...control} name="url" type="url" className="mono" placeholder="https://mcp.example.com/mcp" required autoComplete="off" autoFocus />}</Field>
      </SetupStep>
      <SetupStep n={2} title="How it signs in">
        <Choices name="auth" value="header" options={[['none', 'globe', 'Public'], ['header', 'key', 'Header'], ['oauth', 'user', 'Sign in']]} />
        <div className="hdr">
          <Field label="Header" error={fieldError(error, 'header')}>{(control) => <input {...control} name="headerName" className="mono" defaultValue="Authorization" autoComplete="off" />}</Field>
          <Field label="Value">{(control) => <input {...control} name="headerValue" type="password" className="mono" placeholder="Bearer …" autoComplete="off" />}</Field>
        </div>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={close} error={formError(error, ['url', 'header']) ?? returned}>
      <SetupSubmit pending={createConnection.isPending || authorize.isPending} label="Connect" busy="Connecting…" />
    </SetupFoot>
  </form>
}

function TailscaleFlow({ me, item, info, close, returned }: FlowProps & { me: Me }) {
  const connectTailscale = useConnectTailscale()
  const member = me.user.role === 'member'
  return <form id="connect-main" onSubmit={(event) => connectTailscale.mutate({ authKey: formValues(event)('authKey') })}>
    <SetupSteps>
      <SetupStep n={1} title="Copy an auth key" state="now">
        <div><a className="btn sec sm" href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noreferrer">{ICONS.ext}Open Tailscale keys</a></div>
      </SetupStep>
      <SetupStep n={2} title="Paste it">
        <Field label="Auth key" error={fieldError(connectTailscale.error, 'authKey')}>{(control) =>
          <input {...control} name="authKey" type="password" className="mono" placeholder="tskey-auth-…" required pattern="tskey-auth-[\w\-]{10,200}" title="Paste an auth key. It starts with tskey-auth-." autoComplete="off" disabled={member} />}</Field>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={close} error={formError(connectTailscale.error, ['authKey']) ?? returned}>
      <SetupSubmit pending={connectTailscale.isPending} disabled={member} lock={member ? `Only an owner or admin joins ${item.title}` : undefined} label="Join the tailnet" busy="Joining, installing Tailscale the first time…" />
    </SetupFoot>
  </form>
}

export function nameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url)
    const database = parsed.protocol.startsWith('postgres') ? decodeURIComponent(parsed.pathname.slice(1)) : ''
    return (database || parsed.hostname.replace(/^(www|mcp)\./, '') || fallback).slice(0, 60)
  } catch {
    return fallback
  }
}

type FlowProps = { item: Integration; info: SetupInfo; close: () => void; returned: string | undefined }
