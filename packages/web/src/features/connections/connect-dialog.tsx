import type { ReactNode } from 'react'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { useAdmin } from '@/features/admin/api'
import { useAuthorizeConnection, useConnectTailscale, useCreateConnection } from '@/features/connections/api'
import type { Integration } from '@/features/connections/catalog'
import { GoogleClientSetup } from '@/features/connections/google-client-setup'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

const ROLE_SQL = `create role fastmonkey_reader login password 'choose-a-password';
grant pg_read_all_data to fastmonkey_reader;`

export function ConnectDialog({ me, item }: { me: Me; item: Integration }) {
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  return <Dialog labelledBy="connect-h" className="dlg connect" onClosed={() => navigate('/connections')}>{(close) =>
    <div className="cgrid">
      <aside className="cside">
        <Mark name={item.name} size={48} />
        <h2 id="connect-h">Connect {item.title}</h2>
        <p>{item.blurb}</p>
        <h3>What agents get</h3>
        <ul className="clist">{item.gets.map((line) => <li key={line}>{ICONS.check}<span>{line}</span></li>)}</ul>
        <h3>How it stays safe</h3>
        <ul className="clist safe">{item.safe.map((line) => <li key={line}>{ICONS.check}<span>{line}</span></li>)}</ul>
      </aside>
      <div className="cmain">
        <Flow me={me} item={item} close={close} returned={returned} />
        <button type="button" className="btn ghost sm cclose" onClick={close} aria-label="Close">{ICONS.x}</button>
      </div>
    </div>}
  </Dialog>
}

function Flow({ me, item, close, returned }: FlowProps & { me: Me }) {
  switch (item.name) {
    case 'postgres': return <PostgresFlow item={item} close={close} returned={returned} />
    case 'convex': return <ConvexFlow item={item} close={close} returned={returned} />
    case 'posthog':
    case 'linear': return <SignInFlow item={item} close={close} returned={returned} />
    case 'gmail':
    case 'drive':
    case 'google': return <GoogleFlow me={me} item={item} close={close} returned={returned} />
    case 'tailscale': return <TailscaleFlow me={me} item={item} close={close} returned={returned} />
    case 'mcp': return <McpFlow item={item} close={close} returned={returned} />
  }
}

function PostgresFlow({ item, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  return <>
    <div className="cbody">
      <Step n={1} title="Make a read-only role">
        <p className="mute">Fast Monkey refuses superusers and roles that can run programs. On Postgres 14 or newer this is enough:</p>
        <pre className="snippet">{ROLE_SQL}</pre>
        <div><CopyButton text={ROLE_SQL} label="Copy SQL" /></div>
      </Step>
      <Step n={2} title="Paste its connection string">
        <form id="connect-main" className="cform" onSubmit={(event) => {
          const field = formValues(event)
          createConnection.mutate({ kind: 'postgres', name: field('name'), dsn: field('dsn') })
        }}>
          <NameField item={item} placeholder="Orders DB" error={fieldError(createConnection.error, 'name')} />
          <Field label="Connection string" error={fieldError(createConnection.error, 'dsn')} hint="Only sslmode may follow the ?. Stored sealed and never shown again.">{(control) =>
            <input {...control} name="dsn" className="mono" placeholder="postgres://fastmonkey_reader:…@db.internal:5432/orders" required autoComplete="off" />}</Field>
        </form>
      </Step>
    </div>
    <Foot close={close} error={formError(createConnection.error, ['name', 'dsn']) ?? returned} pending={createConnection.isPending} label="Test and connect" busy="Testing…" />
  </>
}

function ConvexFlow({ item, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  return <>
    <div className="cbody">
      <Step n={1} title="Generate a deploy key">
        <p className="mute">In the Convex dashboard, open the deployment's <b>Settings › Deploy keys</b> and generate one. A production key reads production.</p>
        <div><a className="btn sec sm" href="https://dashboard.convex.dev" target="_blank" rel="noreferrer">{ICONS.ext}Open Convex</a></div>
      </Step>
      <Step n={2} title="Paste it">
        <form id="connect-main" className="cform" onSubmit={(event) => {
          const field = formValues(event)
          createConnection.mutate({ kind: 'convex', name: field('name'), deployKey: field('deployKey') })
        }}>
          <NameField item={item} placeholder="Production" error={fieldError(createConnection.error, 'name')} />
          <Field label="Deploy key" error={fieldError(createConnection.error, 'deployKey')} hint="Fast Monkey lists the deployment's functions to check it.">{(control) =>
            <input {...control} name="deployKey" type="password" className="mono" placeholder="prod:happy-otter-123|eyJ…" required autoComplete="off" />}</Field>
        </form>
      </Step>
    </div>
    <Foot close={close} error={formError(createConnection.error, ['name', 'deployKey']) ?? returned} pending={createConnection.isPending} label="Test and connect" busy="Testing…" />
  </>
}

function SignInFlow({ item, close, returned }: FlowProps) {
  const authorize = useAuthorizeConnection()
  const kind = item.name === 'posthog' ? 'posthog' : 'linear'
  return <>
    <div className="cbody">
      <Step n={1} title="Name it">
        <form id="connect-main" className="cform" onSubmit={(event) => authorize.mutate({ kind, name: formValues(event)('name') })}>
          <NameField item={item} placeholder={item.title} error={fieldError(authorize.error, 'name')} />
        </form>
      </Step>
      <Step n={2} title={`Approve Fast Monkey in ${item.title}`}>
        <p className="mute">{item.title} opens in this tab and asks you to approve Fast Monkey. Fast Monkey registers itself, so there's nothing to copy. You land on the new connection's page when it's done.</p>
      </Step>
    </div>
    <Foot close={close} error={formError(authorize.error, ['name']) ?? returned} pending={authorize.isPending} label={`Sign in with ${item.title}`} busy={`Opening ${item.title}…`} />
  </>
}

function GoogleFlow({ me, item, close, returned }: FlowProps & { me: Me }) {
  const admin = useAdmin()
  const authorize = useAuthorizeConnection()
  const kind = item.name === 'gmail' || item.name === 'drive' ? item.name : 'google'
  if (!admin.data) return <div className="cbody"><ErrorNote message={admin.error?.message} /></div>
  const clientId = admin.data.google.clientId
  return <>
    <div className="cbody">
      <Step n={1} title="Set up Google once" done={!!clientId}>
        {clientId && <p className="mute">Done. Fast Monkey signs in with the OAuth client <span className="mono">{clientId}</span>. Owners and admins change it in Admin.</p>}
        {!clientId && me.user.role !== 'member' && <GoogleClientSetup admin={admin.data} back={location.pathname} />}
        {!clientId && me.user.role === 'member' && <p className="mute">Google doesn't let apps register themselves, so an owner or admin creates an OAuth client once, in Admin. Ask one of them, then come back.</p>}
      </Step>
      <Step n={2} title="Sign in with Google">
        <form id="connect-main" className="cform" onSubmit={(event) => authorize.mutate({ kind, name: formValues(event)('name') })}>
          <NameField item={item} placeholder={item.title} error={fieldError(authorize.error, 'name')} />
        </form>
        <p className="mute">Google asks you to approve the access listed on the left. Agents then work as that Google account.</p>
      </Step>
    </div>
    <Foot close={close} error={formError(authorize.error, ['name']) ?? returned} pending={authorize.isPending} disabled={!clientId} label="Sign in with Google" busy="Opening Google…" />
  </>
}

function McpFlow({ item, close, returned }: FlowProps) {
  const createConnection = useCreateConnection()
  const authorize = useAuthorizeConnection()
  const error = createConnection.error ?? authorize.error
  return <>
    <div className="cbody">
      <form id="connect-main" className="cform steps" onSubmit={(event) => {
        const field = formValues(event)
        const server = { name: field('name'), url: field('url') }
        if (field('auth') === 'oauth') return authorize.mutate({ kind: 'mcp', ...server })
        createConnection.mutate({ kind: 'mcp', ...server, header: field('auth') === 'header' ? `${field('headerName')}: ${field('headerValue')}` : undefined })
      }}>
        <Step n={1} title="Point at the server">
          <NameField item={item} placeholder="Internal tools" error={fieldError(error, 'name')} />
          <Field label="Server URL" error={fieldError(error, 'url')} hint="Its Streamable HTTP endpoint, usually ending in /mcp.">{(control) =>
            <input {...control} name="url" type="url" className="mono" placeholder="https://mcp.example.com/mcp" required autoComplete="off" />}</Field>
        </Step>
        <Step n={2} title="How Fast Monkey signs in">
          <div className="choices" role="radiogroup" aria-label="Sign-in">
            <Choice value="none" title="None" detail="A public server" />
            <Choice value="header" title="A header" detail="An API key or token" checked />
            <Choice value="oauth" title="Sign in" detail="OAuth, in this tab" />
          </div>
          <div className="hdr">
            <Field label="Header" error={fieldError(error, 'header')}>{(control) => <input {...control} name="headerName" className="mono" defaultValue="Authorization" autoComplete="off" />}</Field>
            <Field label="Value">{(control) => <input {...control} name="headerValue" type="password" className="mono" placeholder="Bearer sk_live_…" autoComplete="off" />}</Field>
          </div>
        </Step>
      </form>
    </div>
    <Foot close={close} error={formError(error, ['name', 'url', 'header']) ?? returned} pending={createConnection.isPending || authorize.isPending} label="Connect" busy="Connecting…" />
  </>
}

function TailscaleFlow({ me, item, close, returned }: FlowProps & { me: Me }) {
  const connectTailscale = useConnectTailscale()
  const member = me.user.role === 'member'
  return <>
    <div className="cbody">
      <Step n={1} title="Generate an auth key">
        <p className="mute">In Tailscale's admin console, open <b>Settings › Keys</b> and generate an auth key. Leave Reusable off; add a tag if your ACLs use them.</p>
        <div><a className="btn sec sm" href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noreferrer">{ICONS.ext}Open Tailscale</a></div>
      </Step>
      <Step n={2} title="Paste it">
        <form id="connect-main" className="cform" onSubmit={(event) => connectTailscale.mutate({ authKey: formValues(event)('authKey') })}>
          <Field label="Auth key" error={fieldError(connectTailscale.error, 'authKey')} hint="The first time, this server installs Tailscale. That takes a minute.">{(control) =>
            <input {...control} name="authKey" type="password" className="mono" placeholder="tskey-auth-…" required pattern="tskey-auth-[\w\-]{10,200}" title="Paste an auth key. It starts with tskey-auth-." autoComplete="off" disabled={member} />}</Field>
        </form>
      </Step>
    </div>
    <Foot close={close} error={formError(connectTailscale.error, ['authKey']) ?? returned} pending={connectTailscale.isPending} disabled={member}
      lock={member ? `Only an owner or admin joins ${item.title}` : undefined} label="Join the tailnet" busy="Joining…" />
  </>
}

function Step({ n, title, done = false, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return <section className={done ? 'step done' : 'step'}>
    <h3><span className="stepn">{done ? ICONS.check : n}</span>{title}</h3>
    {children}
  </section>
}

function NameField({ item, placeholder, error }: { item: Integration; placeholder: string; error?: string }) {
  return <Field label="Name" error={error} hint="What people and agents see.">{(control) =>
    <input {...control} name="name" defaultValue={item.title} placeholder={placeholder} required maxLength={60} autoFocus />}</Field>
}

function Choice({ value, title, detail, checked = false }: { value: string; title: string; detail: string; checked?: boolean }) {
  return <label className="choice">
    <input type="radio" name="auth" value={value} defaultChecked={checked} />
    <span className="nm">{title}</span><span className="mute">{detail}</span>
  </label>
}

function Foot({ close, error, pending, disabled = false, lock, label, busy }: { close: () => void; error?: string; pending: boolean; disabled?: boolean; lock?: string; label: string; busy: string }) {
  return <DialogFoot error={error}>
    <button type="button" className="btn sec" onClick={close}>Cancel</button>
    <Locked reason={lock}><button form="connect-main" className="btn primary" disabled={pending || disabled}>{pending ? busy : label}</button></Locked>
  </DialogFoot>
}

type FlowProps = { item: Integration; close: () => void; returned: string | undefined }
