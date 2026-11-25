import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft01Icon, ArrowUpRight01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { SeatUsage } from '@openhut/common/admin/admin.ts'
import { KEY_MESSAGE, PROVIDERS, ProviderId, providerInfo, type Provider, type ProviderModel } from '@openhut/common/models/provider.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { useAdmin, useCompleteSeatSignIn, useSeatUsage, useStartSeatSignIn } from '@/features/settings/api'
import { useAgents } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { Busy, DialogCard, HINT, I, PILL, SetupSheet, Section, Status } from '@/components/kit'
import { Check, CardTitle, ListNote, Row, Rows, useConfirming } from '@/features/settings/kit'
import { useCodexSignIn, useConnectProvider, useDisconnectProvider, useFoundNotice, useProviders, useRefreshProvider, useSetModel } from '@/features/models/api'
import { consequence, count, describe, matches, plural, updatedAgo } from '@/features/models/labels'
import { inUse } from '@/features/agents/form'
import { open, Redirect, useOpen } from '@/lib/router'
import { formValues } from '@/lib/form'
import { openPage } from '@/lib/native'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

let returningTo: ProviderId | undefined
const resetTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const FIRST_SHOWN = 10
const MIN_KEY = 8
const MAX_KEY = 400
const SUBSCRIPTIONS = PROVIDERS.filter((info) => info.kind === 'subscription')
const KEYS = PROVIDERS.filter((info) => info.kind === 'key' && info.id !== 'openhut')

export function stepOf(name: string | null): ProviderId | undefined {
  const parsed = ProviderId.safeParse(name)
  return parsed.success ? parsed.data : undefined
}

export function ModelsSettings() {
  const admin = useAdmin()
  const dialog = useOpen()
  const providers = useProviders().data
  const testModel = admin.data?.seat.mode === 'test'
  const usage = useSeatUsage(!!admin.data && !testModel && admin.data.seat.set)
  useEffect(() => {
    if (returningTo) document.querySelector<HTMLElement>(`[data-provider=${returningTo}]`)?.focus()
    returningTo = undefined
  }, [providers])
  const none = !providers?.some((each) => each.connected)
  const used = inUse(providers)
  const row = (id: ProviderId) => {
    const provider = providers?.find((each) => each.id === id)
    return provider && <ProviderRow key={id} provider={provider} lead={none && id === 'claude'} used={used === id} note={provider.connected ? notesOf({ provider, testModel }) : providerInfo(id).blurb} />
  }
  return <>
    <ErrorNote message={admin.error?.message} />
    {providers && <>
      {none && <p className={cn(HINT, 'px-2.5')}>Connect one so your agents can think. Most people use Claude.</p>}
      {providers.find((each) => each.id === 'openhut')?.connected && <Section title="OpenHut">
        <ListNote>Paid from your OpenHut credits. Your Cloud computer uses these.</ListNote>
        <Rows>{row('openhut')}</Rows>
      </Section>}
      <Section title="Subscriptions"><Rows>{SUBSCRIPTIONS.map((info) => row(info.id))}</Rows></Section>
      <Section title="API keys">
        <ListNote>Your keys work on all your computers. Agents never see them.</ListNote>
        <Rows>{KEYS.map((info) => row(info.id))}</Rows>
      </Section>
    </>}
    {usage.data?.agents.some((agent) => agent.costUsd > 0) && <Spend usage={usage.data} />}
    {dialog === 'seat' && <SeatSignIn />}
  </>
}

function notesOf({ provider, testModel }: { provider: Provider; testModel: boolean }) {
  if (provider.id === 'claude' && testModel) return 'Test model (development)'
  if (provider.kind === 'subscription') return 'On all your computers'
  return [plural({ count: provider.models.length, one: 'model', many: 'models' }), `${count(provider.models.filter((model) => model.on).length)} on`].join(' · ')
}

function ProviderRow({ provider, note, lead, used }: { provider: Provider; note: string; lead: boolean; used: boolean }) {
  const subscription = provider.kind === 'subscription'
  return <Row icon={<Glyph name={provider.id} size={20} />} title={providerInfo(provider.id).short} note={used ? `${note} · In use` : note}>
    {provider.connected
      ? <><Status tone="on">{subscription ? 'Signed in' : 'Connected'}</Status><Button type="button" variant="ghost" className={PILL} data-provider={provider.id} onClick={() => { returningTo = provider.id; open(provider.id) }}>Manage</Button></>
      : <Button type="button" variant={lead ? 'primary' : 'secondary'} className={PILL} data-provider={provider.id} onClick={() => { returningTo = provider.id; open(provider.id === 'claude' ? 'seat' : provider.id) }}>{subscription ? 'Sign in' : 'Add key'}</Button>}
  </Row>
}

export function ModelsStep({ id }: { id: ProviderId }) {
  const provider = useProviders().data?.find((each) => each.id === id)
  const found = useFoundNotice()
  const [notice, setNotice] = useState('')
  const clearNotice = useCallback(() => setNotice(''), [])
  if (!provider) return <div className="flex-1" />
  if (provider.connected) return <Manage provider={provider} notice={notice} clearNotice={clearNotice} />
  if (id === 'claude') return <Redirect to="/settings/models" />
  if (id === 'codex') return <CodexSignInStep onSignedIn={() => setNotice(found(id))} />
  return <ConnectKey provider={provider} onConnected={() => setNotice(found(id))} />
}

export function leave(id: ProviderId) {
  returningTo = id
  open()
}

function StepTitle({ id, children }: { id: ProviderId; children: string }) {
  return <h2 className="m-0 flex shrink-0 items-center gap-2 pt-[26px] pr-[52px] pb-1.5 pl-[26px] text-[15px]/[22px] font-medium">
    <Button type="button" data-back size="icon-sm" aria-label="Back to Models" title="Back" onClick={() => leave(id)}><I icon={ArrowLeft01Icon} size={16} /></Button>{children}
  </h2>
}

function ConnectKey({ provider, onConnected }: { provider: Provider; onConnected: () => void }) {
  const info = providerInfo(provider.id)
  const connect = useConnectProvider()
  const [short, setShort] = useState(false)
  const keyField = useRef<HTMLInputElement>(null)
  useEffect(() => keyField.current?.focus(), [])
  return <SetupSheet brand={provider.id} title={`Connect ${info.short}`} blurb={`Paste an API key from ${info.keysAt}. OpenHut finds the models you can use.`} safe="Takes a few seconds." onClose={() => leave(provider.id)}
    onSubmit={(event) => {
      const field = formValues(event)
      const apiKey = field('key').trim()
      setShort(apiKey.length < MIN_KEY)
      if (apiKey.length >= MIN_KEY) connect.mutate({ id: provider.id, apiKey }, { onSuccess: onConnected })
    }}
    foot={<>
      <Button type="button" variant="secondary" onClick={() => leave(provider.id)}>Cancel</Button>
      {connect.isPending ? <Busy label="Connecting…" /> : <Button type="submit" variant="primary">Connect</Button>}
    </>}>
    <Field label="API key" strong hint="Sealed so only your computers and servers can read it. You won't see it again." error={short ? KEY_MESSAGE : connect.error?.message}>
      {(control) => <Input {...control} ref={keyField} mono type="password" name="key" maxLength={MAX_KEY} autoComplete="off" spellCheck={false} placeholder={info.keyHint ?? undefined} onInput={() => { setShort(false); connect.reset() }} />}
    </Field>
  </SetupSheet>
}

function CodexSignInStep({ onSignedIn }: { onSignedIn: () => void }) {
  const cancel = () => leave('codex')
  const { signIn, error, restart } = useCodexSignIn(onSignedIn)
  return <SetupSheet brand="codex" title="Sign in with ChatGPT" blurb="Open the page below, sign in to ChatGPT and enter this code." safe="Needs ChatGPT Plus or Pro." error={error?.message} onClose={cancel}
    foot={<><Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>{error && <Button type="button" variant="primary" onClick={restart}>Start again</Button>}</>}>
    <div className="flex items-center gap-3 rounded-lg bg-sidebar py-3 pr-3 pl-4">
      <span className="flex-1 font-mono text-[22px] tracking-[.08em]" aria-label="Sign-in code">{signIn?.userCode ?? '····-····'}</span>
      {signIn && <CopyButton text={signIn.userCode} label="Copy" variant="ghost" className={PILL} />}
    </div>
    {signIn && <a href={signIn.url} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), 'self-start')}>Open {new URL(signIn.url).host}<I icon={ArrowUpRight01Icon} size={14} /></a>}
    {!error && <span className="inline-flex items-center gap-2 text-[13px] text-mute"><Spinner className="mt-0" />{signIn ? 'Waiting for you to approve it…' : 'Getting a code…'}</span>}
  </SetupSheet>
}

function Manage({ provider, notice, clearNotice }: { provider: Provider; notice: string; clearNotice: () => void }) {
  const info = providerInfo(provider.id)
  const admin = useAdmin().data
  const agents = useAgents().data ?? []
  const refresh = useRefreshProvider()
  const disconnect = useDisconnectProvider()
  const setModel = useSetModel()
  const { confirming, setConfirming, box } = useConfirming()
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState(false)
  const [all, setAll] = useState(false)
  const toggle = useCallback((model: string, on: boolean) => {
    clearNotice()
    setModel.mutate({ id: provider.id, model, on }, { onError: toastError })
  }, [clearNotice, setModel.mutate, provider.id])
  const subscription = provider.kind === 'subscription'
  const off = subscription ? 'Sign out' : 'Disconnect'
  const fixed = provider.id === 'claude'
  const keepsSignedIn = fixed && admin?.seat.mode === 'test'
  const effect = consequence({ agents, id: provider.id })
  const shown = provider.models.filter((model) => (!only || model.on) && matches({ model, query }))
  const visible = query.trim() || all ? shown : shown.slice(0, FIRST_SHOWN)
  const updated = updatedAgo(provider.updatedAt)
  return <div className="flex min-h-0 flex-1 flex-col">
    <StepTitle id={provider.id}>{provider.name}</StepTitle>
    <div className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pt-[18px] pb-10">
      <div ref={box}><Row icon={<Glyph name={provider.id} size={20} />} title={confirming ? `${off}${subscription ? ' of' : ''} ${info.short}?` : provider.name}
        note={confirming ? effect : <>{provider.keyHint && <span className="font-mono">{provider.keyHint}</span>}{provider.keyHint && updated && ' · '}{updated && `updated ${updated}`}</>}>
        {confirming
          ? <>
            <Button type="button" variant="secondary" className={PILL} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" variant="danger" className={PILL} disabled={disconnect.isPending} onClick={() => { leave(provider.id); disconnect.mutate(provider.id) }}>{off}</Button>
          </>
          : <>
            {!fixed && <Button type="button" variant="ghost" className={PILL} disabled={refresh.isPending} onClick={() => { clearNotice(); refresh.mutate(provider.id, { onError: toastError }) }}>{refresh.isPending ? 'Refreshing…' : 'Refresh models'}</Button>}
            {!keepsSignedIn && <Button type="button" variant="danger" className={PILL} onClick={() => setConfirming(true)}>{off}</Button>}
          </>}
      </Row></div>
      {notice && <p role="status" className="m-0 flex items-center gap-2 px-2.5 text-[13px]/[18px] text-body"><I icon={Tick02Icon} size={16} className="text-success-foreground" />{notice}</p>}
      {refresh.isSuccess && !notice && <p role="status" className="m-0 flex items-center gap-2 px-2.5 text-[13px]/[18px] text-body"><I icon={Tick02Icon} size={16} className="text-success-foreground" />Up to date. {plural({ count: provider.models.length, one: 'model', many: 'models' })}.</p>}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <I icon={Search01Icon} size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${plural({ count: provider.models.length, one: 'model', many: 'models' })}`} autoComplete="off" aria-label="Search models" className="h-9 pl-8" />
          </div>
          <ToggleGroup value={only ? 'on' : 'all'} onPick={(value) => setOnly(value === 'on')} aria-label="Filter"><ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="on">On</ToggleGroupItem></ToggleGroup>
        </div>
        <p className={cn(HINT, 'px-2.5 pt-2.5 pb-1')}>Models you turn off are hidden when you choose an agent's model.</p>
        <Rows>
          {visible.map((model) => <ModelRow key={model.id} provider={provider} model={model} onSwitch={toggle} />)}
          {!shown.length && <p className="m-0 px-2.5 py-1 text-[12px] text-mute">No models match.</p>}
        </Rows>
        {!query.trim() && !all && shown.length > FIRST_SHOWN && <div className="px-2.5 pt-1.5"><Button type="button" variant="text" className="text-[12px]" onClick={() => setAll(true)}>Show all {count(shown.length)}</Button></div>}
      </div>
    </div>
  </div>
}

const ModelRow = memo(function ModelRow({ provider, model, onSwitch }: { provider: Provider; model: ProviderModel; onSwitch: (model: string, on: boolean) => void }) {
  const note = describe({ provider, model })
  const id = provider.id === 'openrouter' ? <><span className="font-mono">{model.id}</span>{note && ' · '}</> : null
  return <Row icon={<Glyph name={provider.id} size={16} />} title={model.name} note={<>{id}{note}</>}>
    <Switch checked={model.on} aria-label={model.name} onCheckedChange={(on) => onSwitch(model.id, on)} />
  </Row>
}, (a, b) => a.model === b.model && a.provider.id === b.provider.id && a.onSwitch === b.onSwitch)

function Spend({ usage }: { usage: SeatUsage }) {
  const used = [...usage.agents].filter((agent) => agent.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd)
  const total = used.reduce((sum, agent) => sum + agent.costUsd, 0)
  const week = usage.windows.find((each) => each.kind === 'seven_day')
  const agents = useAgents().data ?? []
  return <Section title="Claude this week" action={<span className="text-mute">{[usageLine(usage), week && `${week.percent}% of the weekly limit`].filter(Boolean).join(' · ')}</span>}>
    <Rows>{used.map((agent) => {
      const known = agents.find((each) => each.id === agent.agentId)
      return <Row key={agent.agentId} icon={known ? <Face agent={known} size={20} /> : <i className="size-5 rounded-[24%] bg-hover" />} title={agent.agentName}>
        <span className="text-mute tabular-nums">{Math.max(1, Math.round((agent.costUsd / total) * 100))}%</span>
        <span className="w-16 text-right font-mono text-xs tabular-nums">${agent.costUsd.toFixed(2)}</span>
      </Row>
    })}</Rows>
  </Section>
}

function usageLine(usage: SeatUsage | undefined) {
  const fiveHour = usage?.windows.find((each) => each.kind === 'five_hour')
  if (!fiveHour) return undefined
  const reset = fiveHour.resetsAt ? ` · resets ${resetTime.format(new Date(fiveHour.resetsAt))}` : ''
  return `${Math.round(fiveHour.percent)}% of the 5-hour limit used${reset}`
}

const DOWNLOAD_POLL_MS = 1000

export function SeatSignIn({ start: prepared, onClose = () => open(), onDone = () => open() }: { start?: ReturnType<typeof useStartSeatSignIn>; onClose?: () => void; onDone?: () => void }) {
  const own = useStartSeatSignIn()
  const start = prepared ?? own
  const complete = useCompleteSeatSignIn()
  const started = useRef(false)
  const shown = useRef(false)
  const code = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState(false)
  const { mutate, isIdle, isError } = start
  useEffect(() => {
    if (started.current || !(isIdle || isError)) return
    started.current = true
    mutate()
  }, [mutate, isIdle, isError])
  const signIn = start.data
  useEffect(() => {
    if (!signIn?.url || shown.current) return
    shown.current = true
    openPage(signIn.url)
  }, [signIn?.url])
  useEffect(() => {
    const pick = () => void navigator.clipboard.readText().then((text) => {
      const found = text.trim()
      if (!code.current || code.current.value || !/^\S{10,}$/.test(found) || /^https?:/.test(found)) return
      code.current.value = found
      setPicked(true)
    }, () => undefined)
    addEventListener('focus', pick)
    return () => removeEventListener('focus', pick)
  }, [])
  const admin = useAdmin()
  const { refetch } = admin
  const waiting = start.isPending
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { void refetch() }, DOWNLOAD_POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, refetch])
  const download = admin.data?.seat.download
  return <DialogCard className="w-[520px]" onClose={onClose}>
    <form className="contents" onSubmit={(event) => signIn && complete.mutate({ id: signIn.id, code: formValues(event)('code') }, { onSuccess: onDone })}>
      <div className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-lg bg-[#D97757]/12"><Glyph name="claude" size={20} /></span><CardTitle>Sign in with Claude</CardTitle></div>
      {start.error
        ? <FieldError>{start.error.message}</FieldError>
        : <p className="m-0 text-[13px]/[18px] text-body">{signIn?.url
          ? <>claude.ai opened in your browser. Press <b>Authorize</b>, then <b>Copy code</b>. We’ll pick it up when you come back. <a href={signIn.url} target="_blank" rel="noreferrer">Open claude.ai again</a></>
          : <span className="inline-flex items-center gap-2"><Spinner className="mt-0" />{download ? `Getting Claude Code ready · ${download.total ? Math.floor((download.done / download.total) * 100) : 0}%` : 'Starting the Claude sign-in. This takes about 10 seconds.'}</span>}</p>}
      <Input ref={code} mono name="code" required minLength={10} autoComplete="off" spellCheck={false} aria-label="Code from claude.ai" placeholder="Paste the code from claude.ai" disabled={!signIn} autoFocus onInput={() => setPicked(false)} />
      {picked && <p className="m-0 -mt-1 text-[12px] text-mute">Pasted your code from claude.ai.</p>}
      {complete.error && <FieldError>{complete.error.message}</FieldError>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!signIn || complete.isPending}>{complete.isPending ? 'Signing in…' : 'Sign in'}</Button></div>
    </form>
  </DialogCard>
}
