import { useEffect, useRef, type ReactNode } from 'react'
import type { Admin, AgentContainer, SeatUsage, SeatWindow } from '@openhut/common/admin/admin.ts'
import type { OAuthGrant } from '@openhut/common/team/oauth.ts'
import type { Me } from '@openhut/common/team/team.ts'
import type { BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogBody, DialogBox, DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Empty } from '@/components/ui/empty'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { Meter as MeterBar } from '@/components/ui/meter'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Creature } from '@/components/creature'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Fact, Facts } from '@/components/facts'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { useAdmin, useCompleteSeatSignIn, useContainers, useSeatUsage, useStartSeatSignIn, useStartUpdate, useDeleteOAuthGrant, useOAuthGrants, useUpdateAdmin } from '@/features/admin/api'
import { useAgents } from '@/features/agents/api'
import { GoogleClientSetup } from '@/features/connections/google-client-setup'
import { ago, shortDate } from '@/lib/format'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const PANEL = 'flex flex-col gap-2.5 border-t border-hair pt-3.5 pb-4'
const USAGE = 'gap-1.5 py-3'
const UPDATING = 'flex-row items-start gap-2.5 text-mute'

export type AdminForm = 'seat' | 'public-url' | 'google' | 'containers'

const APP_MARKS: BrandName[] = ['claude', 'cursor', 'copilot', 'gemini', 'windsurf', 'zed']

export function AdminPage({ me, form }: { me: Me; form: AdminForm | undefined }) {
  const admin = useAdmin()
  if (!admin.data) return <Page title="Admin"><ErrorNote message={admin.error?.message} /></Page>
  return <AdminView admin={admin.data} canEdit={me.user.role !== 'member'} form={form} />
}

function AdminView({ admin, canEdit, form }: { admin: Admin; canEdit: boolean; form: AdminForm | undefined }) {
  const { server } = admin
  const usage = admin.seat.set && admin.seat.mode === 'claude'
  return <Page title="Admin">
    <div className="mx-auto flex max-w-[880px] flex-col">
      <Section number={1} title="Claude seat">
        <Row icon="claude" title="Claude seat" subtitle={seatLine(admin)} status={admin.seat.set ? <Ready word="Connected" /> : <StatusBadge status="not_set_up" />}
          action={<ToggleButton label={admin.seat.set ? 'Replace' : 'Set up'} form="seat" open={form === 'seat'} canEdit={canEdit} reason="Only an owner or admin sets the seat" onOpen={openSeatTab} />} />
        {form === 'seat' && canEdit && <SeatForm />}
        {usage && <UsagePanel />}
      </Section>
      <Section number={2} title="Server">
        <Row icon="globe" title="Public URL" mono subtitle={admin.publicUrl}
          action={<ToggleButton label="Edit" form="public-url" open={form === 'public-url'} canEdit={canEdit} reason="Only an owner or admin changes it" />} />
        {form === 'public-url' && canEdit && <PublicUrlForm publicUrl={admin.publicUrl} />}
        <VersionRow server={server} canEdit={canEdit} />
        <Row icon="box" title="Containers" subtitle={`${server.running} of ${server.total} agents running, as Docker reports them`}
          action={<ToggleButton label="View" form="containers" open={form === 'containers'} canEdit={canEdit} reason="Only an owner or admin sees the containers" />} />
      </Section>
      <Section number={3} title="Google">
        <Row icon="google" title="Google OAuth client" mono={!!admin.google.clientId} subtitle={admin.google.clientId ?? 'Needed before anyone connects Gmail, Google Drive or Google Workspace'}
          status={admin.google.clientId ? <Ready word="Ready" /> : <StatusBadge status="not_set_up" />}
          action={<ToggleButton label={admin.google.clientId ? 'Replace' : 'Set up'} form="google" open={form === 'google'} canEdit={canEdit} reason="Only an owner or admin sets it" />} />
        {form === 'google' && canEdit && <div className={PANEL} id="google"><GoogleClientSetup admin={admin} back="/admin" /></div>}
      </Section>
      <Section number={4} title="AI assistant"><ConnectedApps /></Section>
      <Section number={5} title="Usage data">
        <Row icon="globe" title="Share usage data with OpenHut" subtitle={usageLine(admin)} action={<UsageSwitch admin={admin} canEdit={canEdit} />} />
      </Section>
    </div>
    {form === 'containers' && canEdit && <ContainersDialog />}
  </Page>
}

function usageLine(admin: Admin) {
  if (admin.seat.mode === 'test') return 'Test-model servers never send usage data.'
  return 'Anonymous usage events and the owner\'s email, sent to openhut.dev. Never what messages say.'
}

function UsageSwitch({ admin, canEdit }: { admin: Admin; canEdit: boolean }) {
  const updateAdmin = useUpdateAdmin()
  return <Locked reason={canEdit ? undefined : 'Only an owner or admin changes it'}>
    <Switch checked={admin.usageData} aria-label="Share usage data with OpenHut" disabled={!canEdit || updateAdmin.isPending}
      onCheckedChange={() => updateAdmin.mutate({ usageData: !admin.usageData }, { onError: toastError })} />
  </Locked>
}

function ToggleButton({ label, form, open, canEdit, reason, onOpen }: { label: string; form: AdminForm; open: boolean; canEdit: boolean; reason: string; onOpen?: () => void }) {
  return <Locked reason={canEdit ? undefined : reason}>
    <Button type="button" size="sm" disabled={!canEdit} aria-expanded={open} aria-controls={form} onClick={() => { if (!open) onOpen?.(); navigate(open ? '/admin' : `/admin/${form}`) }}>{label}</Button>
  </Locked>
}

const WINDOWS: { kind: SeatWindow['kind']; name: string; idle: string }[] = [
  { kind: 'five_hour', name: '5-hour limit', idle: 'No session open' },
  { kind: 'seven_day', name: 'Weekly limit', idle: 'Not started' },
]
const resetTime = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const SPEND_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

function UsagePanel() {
  const usage = useSeatUsage()
  if (usage.error) return <div className={cn(PANEL, USAGE)}><span className="text-mute">{usage.error.message}</span></div>
  if (!usage.data) return <div className={cn(PANEL, USAGE, UPDATING)} role="status"><Spinner /><span>Asking Claude how much of the seat is used…</span></div>
  return <UsageView usage={usage.data} />
}

function UsageView({ usage }: { usage: SeatUsage }) {
  const slices = spendSlices(usage.agents)
  const ranked = [...slices].sort((a, b) => b.usd - a.usd)
  const total = slices.reduce((sum, slice) => sum + slice.usd, 0)
  return <div className={cn(PANEL, USAGE)}>
    {WINDOWS.map(({ kind, name, idle }) => {
      const window = usage.windows.find((each) => each.kind === kind)
      return <Meter key={kind} label={name} percent={window?.percent ?? 0} note={window?.resetsAt ? `Resets ${resetTime.format(new Date(window.resetsAt))}` : idle} />
    })}
    <span className="mt-1.5 flex items-center gap-1 text-xs text-mute">By agent, this week<Info tip={`Each agent's share of what agents used since ${shortDate.format(new Date(usage.since))}, when this week's limit started, at API prices.`} />{!!slices.length && <span className="ml-auto tabular-nums">${total.toFixed(2)} total</span>}</span>
    {slices.length
      ? <>
        <div className="flex h-2.5 gap-0.5" role="img" aria-label={slices.map((slice) => `${slice.name} ${share(slice.usd, total)}`).join(', ')}>
          {slices.map((slice) => <i key={slice.id} className="block min-w-[3px] basis-0 first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: (slice.usd / total) * 100, background: slice.color }} title={`${slice.name}: $${slice.usd.toFixed(2)}, ${share(slice.usd, total)}`} />)}
        </div>
        <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-hair">
          {ranked.map((slice) => <div key={slice.id} className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto_72px] items-center gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2.5"><i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} /><span className="truncate">{slice.name}</span></span>
            <span className="text-xs text-mute tabular-nums">{share(slice.usd, total)}</span>
            <span className="text-right tabular-nums">${slice.usd.toFixed(2)}</span>
          </div>)}
        </div>
      </>
      : <span className="text-mute">No agent has used the seat this week.</span>}
  </div>
}

function spendSlices(agents: SeatUsage['agents']): SpendSlice[] {
  const used = agents.filter((agent) => agent.costUsd > 0)
  const byCost = [...used].sort((a, b) => b.costUsd - a.costUsd)
  const kept = new Set((used.length > SPEND_COLORS.length ? byCost.slice(0, SPEND_COLORS.length - 1) : byCost).map((agent) => agent.agentId))
  const slices = used.filter((agent) => kept.has(agent.agentId)).map((agent, index) => ({ id: agent.agentId, name: agent.agentName, usd: agent.costUsd, color: SPEND_COLORS[index] }))
  const rest = used.filter((agent) => !kept.has(agent.agentId))
  if (rest.length) slices.push({ id: 'other', name: `${rest.length} more agents`, usd: rest.reduce((sum, agent) => sum + agent.costUsd, 0), color: 'var(--mute-2)' })
  return slices
}

function share(usd: number, total: number): string {
  const percent = (usd / total) * 100
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

type SpendSlice = { id: string; name: string; usd: number; color: string }

function Info({ tip }: { tip: string }) {
  return <span className="inline-flex cursor-help text-mute" role="img" aria-label={tip} title={tip}>{ICONS.info}</span>
}

function Meter({ label, percent, note }: { label: string; percent: number; note: string }) {
  return <div className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_40px_minmax(0,120px)] items-center gap-3 text-sm phone:grid-cols-[minmax(0,1fr)_40px]">
    <span className="flex min-w-0 items-center gap-2"><span className="truncate">{label}</span></span>
    <MeterBar aria-label={label} min={0} max={100} value={Math.min(100, percent)} className="phone:col-span-full phone:row-start-2" />
    <span className="text-right tabular-nums">{percent}%</span>
    <span className="text-xs text-mute phone:hidden">{note}</span>
  </div>
}

function SeatForm() {
  const start = useStartSeatSignIn()
  const complete = useCompleteSeatSignIn()
  const started = useRef(false)
  const { mutate } = start
  useEffect(() => {
    if (started.current) return
    started.current = true
    mutate(undefined, {
      onSuccess: (signIn) => { if (seatTab && !seatTab.closed && signIn.url) seatTab.location.href = signIn.url },
      onError: () => seatTab?.close(),
      onSettled: () => { seatTab = null },
    })
  }, [mutate])
  const signIn = start.data
  return <form className={PANEL} id="seat" onSubmit={(event) => signIn && complete.mutate({ id: signIn.id, code: formValues(event)('code') })}>
    {start.error
      ? <FieldError>{start.error.message} <Button type="button" variant="link" onClick={() => { started.current = false; start.reset(); navigate('/admin', true) }}>Close</Button></FieldError>
      : <span className="text-mute">{signIn?.url
        ? <>claude.ai opened in a new tab. Press Authorize there (in a full-size window), then paste the code it shows. <a href={signIn.url} target="_blank" rel="noreferrer">Open claude.ai again</a></>
        : <span className="inline-flex items-center gap-2"><Spinner className="mt-0" />Starting the Claude sign-in. This takes about 10 seconds.</span>}</span>}
    <div className="flex gap-2">
      <Input mono className="flex-1" name="code" required minLength={10} autoComplete="off" spellCheck={false} aria-label="Code from claude.ai" aria-describedby="seat-error" placeholder="Paste the code from claude.ai" disabled={!signIn} autoFocus />
      <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/admin', true)}>Cancel</Button>
      <Button type="submit" variant="primary" size="sm" disabled={!signIn || complete.isPending}>{complete.isPending ? 'Connecting…' : 'Connect'}</Button>
    </div>
    {complete.error && <FieldError id="seat-error">{complete.error.message}</FieldError>}
  </form>
}

let seatTab: Window | null = null

function openSeatTab() {
  seatTab = window.open('about:blank', '_blank')
  if (!seatTab) return
  seatTab.opener = null
  seatTab.document.title = 'Opening claude.ai…'
  seatTab.document.body.style.cssText = 'font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#555'
  seatTab.document.body.textContent = 'Opening claude.ai… this takes about 10 seconds.'
}

function PublicUrlForm({ publicUrl }: { publicUrl: string }) {
  const updateAdmin = useUpdateAdmin()
  return <form className={PANEL} id="public-url" onSubmit={(event) => updateAdmin.mutate({ publicUrl: formValues(event)('publicUrl') })}>
    <span className="text-mute">The address people open this dashboard on. Invite links and the MCP URL use it.</span>
    <div className="flex gap-2">
      <Input mono className="flex-1" name="publicUrl" type="url" required pattern="https?://.+" maxLength={200} defaultValue={publicUrl} aria-label="Public URL" aria-describedby="public-url-error" autoFocus />
      <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/admin')}>Cancel</Button>
      <Button type="submit" variant="primary" size="sm" disabled={updateAdmin.isPending}>Save</Button>
    </div>
    {updateAdmin.error && <FieldError id="public-url-error">{updateAdmin.error.message}</FieldError>}
  </form>
}

function ConnectedApps() {
  const apps = useOAuthGrants()
  return <Loaded query={apps}>{(grants) => <AppRows grants={grants} />}</Loaded>
}

function AppRows({ grants }: { grants: OAuthGrant[] }) {
  const deleteGrant = useDeleteOAuthGrant()
  if (!grants.length) return <Row icon="mcp" title="Connected apps" subtitle="No apps yet. Add your AI assistant with the prompt on the Agents page." />
  return grants.map((grant) => <Row key={grant.id} icon={appMark(grant.client)} title={grant.client} subtitle={appLine(grant)}
    action={<ConfirmButton size="sm" disabled={deleteGrant.isPending} question={`Disconnect ${grant.client}?`} detail="It can't act as you anymore until you connect it again." action="Disconnect"
      onConfirm={() => deleteGrant.mutate(grant.id, { onError: toastError })}>Disconnect</ConfirmButton>} />)
}

function Section({ number, title, info, children }: { number: number; title: string; info?: string; children: ReactNode }) {
  return <section className="flex flex-col gap-1.5 border-t border-hair py-[22px] first:border-t-0 first:pt-1"><div className="flex items-center gap-2"><span className="font-mono text-xs tracking-[.1em] uppercase">{String(number).padStart(2, '0')} {title}</span>{info && <Info tip={info} />}</div><ItemGroup variant="inset">{children}</ItemGroup></section>
}

function Row({ icon, title, subtitle, mono = false, status, action }: { icon: BrandName; title: string; subtitle: string; mono?: boolean; status?: ReactNode; action?: ReactNode }) {
  return <Item size="md">
    <Mark name={icon} size={40} />
    <ItemContent stacked><span className="flex items-center gap-2 font-medium">{title}</span><span className={cn('truncate text-sm text-mute', mono && 'font-mono text-xs')}>{subtitle}</span></ItemContent>
    {status}{action}
  </Item>
}

function Ready({ word }: { word: string }) {
  return <StatusBadge status="ready" tip={word} word={word} />
}

function VersionRow({ server, canEdit }: { server: Admin['server']; canEdit: boolean }) {
  const startUpdate = useStartUpdate()
  const loadedBuild = useRef(server.build)
  const updating = server.update?.status === 'running'
  useEffect(() => {
    if (server.build !== loadedBuild.current) location.reload()
  }, [server.build])
  return <>
    <Row icon="update" title={`Version ${server.build}`} subtitle={versionLine(server)}
      status={versionStatus(server)}
      action={server.updateAvailable && !updating && <Locked reason={canEdit ? undefined : 'Only an owner or admin can update'}>
        <Button type="button" variant="secondary" size="sm" disabled={!canEdit || startUpdate.isPending} onClick={() => startUpdate.mutate(undefined, { onError: toastError })}>{server.update ? 'Try again' : 'Update now'}</Button>
      </Locked>} />
    {updating && <div className={cn(PANEL, UPDATING)} role="status"><Spinner />
      <span>Updating to version <span className="font-mono text-xs">{server.update?.to}</span>. The app and its agents restart once. You can leave or refresh; this page follows along.</span></div>}
    {server.update?.status === 'failed' && <div className={PANEL}><span className="text-mute" role="status">The last update didn't finish, so it went back to version <span className="font-mono text-xs">{server.build}</span>. Nothing was lost. Details: <code>journalctl -u openhut-update</code> on the server.</span></div>}
  </>
}

function versionStatus(server: Admin['server']) {
  if (server.update?.status === 'running') return <StatusBadge status="no_calls" tip="An update is being installed" word="Updating" />
  if (server.healthy) return <Ready word="Healthy" />
  return <StatusBadge status="missing" tip="Agents can't start until this is fixed. See /health." word="Not responding" />
}

function versionLine(server: Admin['server']) {
  if (server.update?.status === 'running') return `Updating to version ${server.update.to}`
  if (server.updateAvailable) return `Version ${server.latestBuild} is available`
  if (server.latestBuild === null) return "Couldn't check for a newer release"
  return 'Up to date'
}

function seatLine(admin: Admin) {
  if (admin.seat.mode === 'test') return "Test mode: agents use the built-in test model, not a seat"
  if (admin.seat.set) return 'Saved on this server'
  return 'Claude mode, but no seat token is stored'
}

function appMark(client: string) {
  return APP_MARKS.find((name) => client.toLowerCase().includes(name)) ?? 'mcp'
}

function appLine(grant: OAuthGrant) {
  const used = grant.usedAt ? `last used ${ago(grant.usedAt)} ago` : 'not used yet'
  return `Connected ${shortDate.format(new Date(grant.createdAt))} · ${used}`
}

function ContainersDialog() {
  const containers = useContainers()
  const agents = useAgents()
  const about = (agentId: string) => agents.data?.find((agent) => agent.id === agentId)?.instructions
  const close = () => navigate('/admin', true)
  return <Dialog onClose={close}><DialogBox height="auto">
    <DialogHead title="Containers" subtitle={<>Straight from <code>docker ps -a</code> on this server, next to what each agent should be doing. Refreshes every 5 seconds.</>} onClose={close} />
    <DialogBody>
      <Loaded query={containers}>{(list) => list.length
        ? <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">{list.map((row) => <ContainerCard key={`${row.agentId}-${row.name ?? 'none'}`} row={row} about={about(row.agentId)} />)}</div>
        : <Empty>No agent containers on this server.</Empty>}</Loaded>
    </DialogBody>
    <DialogFoot><Button type="button" variant="secondary" onClick={close}>Close</Button></DialogFoot>
  </DialogBox></Dialog>
}

function ContainerCard({ row, about }: { row: AgentContainer; about: string | undefined }) {
  const disagree = row.wanted === null || (row.wanted === 'running') !== (row.state === 'running')
  return <Card className="flex min-w-0 flex-col">
    <CardHeader>
      <Creature id={row.agentId} about={about} size={36} />
      <div className="min-w-0 flex-1"><div className="truncate font-medium">{row.agentName ?? 'Deleted agent'}</div><div className="truncate font-mono text-xs text-mute">{row.name ?? row.agentId}</div></div>
      <Badge variant={stateBadge(row.state)}>{row.state === 'none' ? 'No container' : row.state}</Badge>
    </CardHeader>
    <Facts boxed={false} className="[&>div>span:last-child]:min-w-0 [&>div>span:last-child]:text-right">
      <Fact label="Should be"><span>{row.wanted ?? 'Agent deleted'}</span></Fact>
      <Fact label="Docker"><span className="truncate">{row.status}</span></Fact>
      <Fact label="Image"><span className="truncate font-mono text-xs" title={row.image}>{row.image ? row.image.split('@')[0].split('/').pop() : '—'}</span></Fact>
      <Fact label="Created"><span className="font-mono text-xs">{row.createdAt ? row.createdAt.slice(0, 16) : '—'}</span></Fact>
    </Facts>
    {disagree && <p className="m-0 px-4 pt-2 pb-3 text-sm text-warning-foreground">Docker and the app disagree. Reconcile fixes this within 30 seconds while the agent should run.</p>}
  </Card>
}

function stateBadge(state: AgentContainer['state']) {
  if (state === 'running') return 'success'
  if (state === 'none') return 'destructive'
  return 'secondary'
}
