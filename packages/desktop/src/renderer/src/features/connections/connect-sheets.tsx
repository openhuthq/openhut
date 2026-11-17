import { useRef, useState } from 'react'
import type { Me } from '@openhut/common/team/team.ts'
import { LinkSquare02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MultiSelect } from '@/components/ui/multi-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Glyph } from '@/components/glyph'
import { useAuthorizeConnection, useConnectTailscale, useCreateConnection } from '@/features/connections/api'
import type { Integration } from '@/features/connections/catalog'
import { GoogleClientSetup } from '@/features/connections/google-client-setup'
import { Field, Lines, Warn } from '@/features/connections/sheet'
import { Command } from '@/features/settings/kit'
import { useComputers } from '@/features/computers/api'
import { useAdmin } from '@/features/settings/api'
import { Busy, I, SetupSheet, Step } from '@/components/kit'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

const ROLE_SQL = `create role openhut_reader login password 'choose-a-password';
grant pg_read_all_data to openhut_reader;`

type FlowProps = { me: Me; item: Integration; close: () => void; returned: string | undefined }

export function ConnectSheet({ me, item }: { me: Me; item: Integration }) {
  const returned = new URLSearchParams(location.search).get('error') ?? undefined
  const props = { me, item, returned, close: () => navigate('/connections') }
  switch (item.name) {
    case 'postgres': return <PostgresSheet {...props} />
    case 'convex': return <ConvexSheet {...props} />
    case 'github': return <GithubSheet {...props} />
    case 'gmail':
    case 'drive':
    case 'google': return <GoogleSheet {...props} />
    case 'tailscale': return <TailscaleSheet {...props} />
    case 'mcp': return <McpSheet {...props} />
    default: return <SimpleSheet {...props} />
  }
}

function sheetOf(item: Integration) {
  return { brand: item.name, title: `Connect ${item.title}`, blurb: item.blurb, eta: item.eta, safe: item.safeLine }
}

function PostgresSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const [mode, setMode] = useState('dsn')
  const putOn = usePutOn()
  return <SetupSheet {...sheetOf(item)} safe={undefined} onClose={close} error={formError(create.error, ['dsn', 'name']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      const dsn = mode === 'dsn' ? field('dsn') : `postgres://${encodeURIComponent(field('user'))}:${encodeURIComponent(field('password'))}@${field('host')}:${field('port') || '5432'}/${encodeURIComponent(field('database'))}`
      create.mutate({ kind: 'postgres', name: field('name').trim(), dsn, computers: putOn.picked })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{create.isPending ? <Busy label="Testing…" /> : <Button type="submit" variant="primary">Test and connect</Button>}</>}>
    {putOn.row({ placeholder: 'Billing DB', error: fieldError(create.error, 'name') })}
    <Step n={1} title="Make a role for OpenHut" state="now" tag="recommended">
      <Command text={ROLE_SQL} />
    </Step>
    <Step n={2} title="Tell OpenHut where it is" state="now">
      <ToggleGroup aria-label="How to enter it" className="w-fit" value={mode} onPick={setMode}>
        <ToggleGroupItem className="text-[13px]" value="dsn">Connection string</ToggleGroupItem>
        <ToggleGroupItem className="text-[13px]" value="fields">Host and port</ToggleGroupItem>
      </ToggleGroup>
      {mode === 'dsn'
        ? <><Input mono name="dsn" required aria-label="Connection string" placeholder="postgres://openhut_reader:…@host:5432/db" autoComplete="off" />{fieldError(create.error, 'dsn') && <FieldError>{fieldError(create.error, 'dsn')}</FieldError>}</>
        : <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2.5">
          <Field label="Host"><Input mono name="host" required placeholder="db.acme.internal" autoComplete="off" /></Field>
          <Field label="Port"><Input mono name="port" defaultValue="5432" inputMode="numeric" autoComplete="off" /></Field>
          <Field label="Database"><Input mono name="database" required placeholder="billing" autoComplete="off" /></Field>
          <span />
          <Field label="User"><Input mono name="user" required defaultValue="openhut_reader" autoComplete="off" /></Field>
          <span />
          <Field label="Password"><Input mono name="password" type="password" required placeholder="••••••••" autoComplete="off" /></Field>
        </div>}
    </Step>
    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]/[18px] text-body">{item.safe.slice(1).map((line) => <li key={line} className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-x-3"><span className="grid place-items-center"><I icon={Tick02Icon} size={14} className="text-mute" /></span>{line}</li>)}</ul>
  </SetupSheet>
}

function ConvexSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const putOn = usePutOn()
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(create.error, ['deployKey', 'name']) ?? returned}
    onSubmit={(event) => {
      const deployKey = formValues(event)('deployKey')
      create.mutate({ kind: 'convex', name: formValues(event)('name').trim(), deployKey, computers: putOn.picked })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{create.isPending ? <Busy label="Testing…" /> : <Button type="submit" variant="primary">Test and connect</Button>}</>}>
    {putOn.row({ placeholder: 'Production', error: fieldError(create.error, 'name') })}
    {item.warn && <Warn>{item.warn}</Warn>}
    <Step n={1} title="Copy a deploy key" state="now">
      <div><a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href="https://dashboard.convex.dev" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Open Convex, then Settings › Deploy keys</a></div>
    </Step>
    <Step n={2} title="Paste it" state="now">
      <Field label="Deploy key" error={fieldError(create.error, 'deployKey')}><Input mono name="deployKey" type="password" required placeholder="prod:happy-otter-123|eyJ…" autoComplete="off" /></Field>
    </Step>
    <Lines title="Agents get" lines={item.gets} />
  </SetupSheet>
}

function GithubSheet({ item, close, returned }: FlowProps) {
  const authorize = useAuthorizeConnection()
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(authorize.error, ['name', 'organization']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      authorize.mutate({ kind: 'github', name: field('name'), organization: field('organization') || undefined })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{authorize.isPending ? <Busy label="Opening GitHub…" /> : <Button type="submit" variant="primary"><Glyph name="github" size={14} onTile />Create the bot on GitHub</Button>}</>}>
    {item.warn && <Warn>{item.warn}</Warn>}
    <Step n={1} title="Name the bot" state="now">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Bot name" error={fieldError(authorize.error, 'name')}><Input name="name" required maxLength={34} placeholder="acme-hut" autoComplete="off" /></Field>
        <Field label="Organization" error={fieldError(authorize.error, 'organization')}><Input name="organization" pattern="[A-Za-z0-9\-]{1,39}" title="The organization as it appears in its GitHub URL." placeholder="Empty for your own account" autoComplete="off" /></Field>
      </div>
      <p className="m-0 font-copy text-[11.5px]/[1.55] text-mute">Commits and pull requests show as name[bot]. The name must be free on GitHub.</p>
    </Step>
    <Step n={2} title="Create it on GitHub" tag="one click" />
    <Step n={3} title="Pick its repositories" tag="on GitHub" />
  </SetupSheet>
}

function GoogleSheet({ item, close, returned }: FlowProps) {
  const admin = useAdmin()
  const authorize = useAuthorizeConnection()
  const [replacing, setReplacing] = useState(false)
  const kind = item.name === 'gmail' || item.name === 'drive' ? item.name : 'google'
  const saved = !!admin.data?.google.clientId && !replacing
  const putOn = usePutOn()
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(authorize.error, ['name']) ?? admin.error?.message ?? returned}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      <Button type="button" variant="primary" disabled={!saved || authorize.isPending} onClick={() => authorize.mutate({ kind, name: putOn.name() || item.title })}>{authorize.isPending ? 'Opening Google…' : <><Glyph name="google" size={14} />Sign in with Google</>}</Button></>}>
    {putOn.row({ placeholder: item.title, error: fieldError(authorize.error, 'name'), signIn: true })}
    <Step n={1} title="Set up Google once" state={saved ? 'done' : 'now'}
      tag={saved ? <span className="inline-flex items-center gap-2">Saved<Button type="button" variant="link" className="text-mute" onClick={() => setReplacing(true)}>Replace</Button></span> : 'once per server'}>
      {!saved && admin.data && <GoogleClientSetup admin={admin.data} onSaved={() => setReplacing(false)} />}
    </Step>
    <Step n={2} title="Sign in with Google" state={saved ? 'now' : 'next'}>
      {saved && <Lines lines={item.safe} tone="success" />}
    </Step>
  </SetupSheet>
}

function TailscaleSheet({ item, close, returned }: FlowProps) {
  const join = useConnectTailscale()
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(join.error, ['authKey']) ?? returned}
    onSubmit={(event) => join.mutate({ authKey: formValues(event)('authKey') })}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{join.isPending ? <Busy label="Joining…" /> : <Button type="submit" variant="primary"><Glyph name="tailscale" size={14} onTile />Join the tailnet</Button>}</>}>
    <Step n={1} title="Copy an auth key" state="now">
      <div><a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Open Tailscale keys</a></div>
    </Step>
    <Step n={2} title="Paste it" state="now">
      <Field label="Auth key" error={fieldError(join.error, 'authKey')}><Input mono name="authKey" type="password" required pattern="tskey-auth-[\w\-]{10,200}" title="Paste an auth key. It starts with tskey-auth-." placeholder="tskey-auth-…" autoComplete="off" /></Field>
    </Step>
    <Lines title="Agents get" lines={item.gets} />
  </SetupSheet>
}

function McpSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const authorize = useAuthorizeConnection()
  const [auth, setAuth] = useState('header')
  const putOn = usePutOn()
  const error = create.error ?? authorize.error
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(error, ['url', 'header', 'name']) ?? returned}
    onSubmit={(event) => {
      const field = formValues(event)
      const server = { name: field('name').trim(), url: field('url') }
      if (auth === 'oauth') return authorize.mutate({ kind: 'mcp', ...server })
      create.mutate({ kind: 'mcp', ...server, header: auth === 'header' ? `${field('headerName')}: ${field('headerValue')}` : undefined, computers: putOn.picked })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>{create.isPending || authorize.isPending ? <Busy label="Connecting…" /> : <Button type="submit" variant="primary">Connect</Button>}</>}>
    {putOn.row({ placeholder: 'Docs search', error: fieldError(error, 'name'), signIn: auth === 'oauth' })}
    <Step n={1} title="Server URL" state="now">
      <Field label="URL" error={fieldError(error, 'url')}><Input mono name="url" type="url" required placeholder="https://mcp.example.com/mcp" autoComplete="off" /></Field>
    </Step>
    <Step n={2} title="How it signs in" state="now">
      <ToggleGroup aria-label="How it signs in" className="w-fit" value={auth} onPick={setAuth}>
        <ToggleGroupItem className="text-[13px]" value="none">Public</ToggleGroupItem>
        <ToggleGroupItem className="text-[13px]" value="header">Header</ToggleGroupItem>
        <ToggleGroupItem className="text-[13px]" value="oauth">Sign in</ToggleGroupItem>
      </ToggleGroup>
      {auth === 'header' && <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-2.5">
        <Field label="Header" error={fieldError(error, 'header')}><Input mono name="headerName" defaultValue="Authorization" autoComplete="off" /></Field>
        <Field label="Value"><Input mono name="headerValue" type="password" placeholder="Bearer …" autoComplete="off" /></Field>
      </div>}
    </Step>
    <Lines title="Kept safe" lines={item.safe} />
  </SetupSheet>
}

function SimpleSheet({ item, close, returned }: FlowProps) {
  const create = useCreateConnection()
  const authorize = useAuthorizeConnection()
  const signIn = item.name === 'posthog' || item.name === 'linear' ? item.name : undefined
  const putOn = usePutOn()
  return <SetupSheet {...sheetOf(item)} onClose={close} error={formError(create.error ?? authorize.error, ['name']) ?? returned}
    onSubmit={(event) => {
      const name = formValues(event)('name').trim()
      if (signIn) authorize.mutate({ kind: signIn, name })
      else create.mutate({ kind: 'excalidraw', name, computers: putOn.picked })
    }}
    foot={<><Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      {create.isPending || authorize.isPending ? <Busy label={signIn ? `Opening ${item.title}…` : 'Connecting…'} /> : <Button type="submit" variant="primary"><Glyph name={item.name} size={14} onTile />{signIn ? `Sign in with ${item.title}` : 'Connect'}</Button>}</>}>
    {putOn.row({ placeholder: item.title, error: fieldError(create.error ?? authorize.error, 'name'), signIn: !!signIn })}
    {item.warn && <Warn>{item.warn}</Warn>}
    <Lines title="Agents get" lines={item.gets} />
    <Lines title="Kept safe" lines={item.safe} />
  </SetupSheet>
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

function usePutOn() {
  const computers = useComputers().data ?? []
  const [picked, setPicked] = useState(['local'])
  const input = useRef<HTMLInputElement>(null)
  const many = computers.length > 1
  const row = ({ placeholder, error, signIn = false }: { placeholder: string; error: string | undefined; signIn?: boolean }) => <div className={cn('grid gap-2.5', many && 'grid-cols-[3fr_2fr]')}>
    <Field label="Name" error={error}><Input ref={input} name="name" required placeholder={placeholder} maxLength={60} autoComplete="off" /></Field>
    {many && <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-mute">Computers</span>
      {signIn
        ? <span className="flex h-8 items-center text-[13px] text-mute">This Mac only for now</span>
        : <MultiSelect label="Computers" value={picked} onChange={(next) => next.length > 0 && setPicked(next)} options={computers.map((computer) => ({ value: computer.id, label: computer.name, disabled: !computer.online, note: computer.online ? undefined : 'Offline' }))} />}
    </div>}
  </div>
  return { picked: many ? picked : undefined, row, name: () => input.current?.value.trim() ?? '' }
}
