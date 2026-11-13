import { useEffect, useRef, type ReactNode } from 'react'
import type { Admin, AgentContainer } from '@fastmonkey/common/admin/admin.ts'
import type { OAuthGrant } from '@fastmonkey/common/team/oauth.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import type { BrandName } from '@/components/brand-icons'
import { Avatar } from '@/components/avatar'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { Page } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { useAdmin, useCompleteSeatSignIn, useContainers, useStartSeatSignIn, useStartUpdate, useDeleteOAuthGrant, useOAuthGrants, useUpdateAdmin } from '@/features/admin/api'
import { useAgents } from '@/features/agents/api'
import { GoogleClientSetup } from '@/features/connections/google-client-setup'
import { ago, shortDate } from '@/lib/format'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

export type AdminForm = 'seat' | 'public-url' | 'google' | 'containers'

const APP_MARKS: BrandName[] = ['claude', 'cursor', 'copilot', 'gemini', 'windsurf', 'zed']

export function AdminPage({ me, form }: { me: Me; form: AdminForm | undefined }) {
  const admin = useAdmin()
  if (!admin.data) return <Page title="Admin"><ErrorNote message={admin.error?.message} /></Page>
  return <AdminView admin={admin.data} canEdit={me.user.role !== 'member'} form={form} />
}

function AdminView({ admin, canEdit, form }: { admin: Admin; canEdit: boolean; form: AdminForm | undefined }) {
  const { server } = admin
  return <Page title="Admin">
    <div className="admin">
      <Section number={1} title="Claude seat">
        <Row icon="claude" title="Claude seat" subtitle={seatLine(admin)} status={admin.seat.set ? <Ready word="Connected" /> : <StatusBadge status="not_set_up" />}
          action={<ToggleButton label={admin.seat.set ? 'Replace' : 'Set up'} form="seat" open={form === 'seat'} canEdit={canEdit} reason="Only an owner or admin sets the seat" onOpen={openSeatTab} />} />
        {form === 'seat' && canEdit && <SeatForm />}
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
        {form === 'google' && canEdit && <div className="aform" id="google"><GoogleClientSetup admin={admin} back="/admin" /></div>}
      </Section>
      <Section number={4} title="AI assistant"><ConnectedApps /></Section>
    </div>
    {form === 'containers' && canEdit && <ContainersDialog />}
  </Page>
}

function ToggleButton({ label, form, open, canEdit, reason, onOpen }: { label: string; form: AdminForm; open: boolean; canEdit: boolean; reason: string; onOpen?: () => void }) {
  return <Locked reason={canEdit ? undefined : reason}>
    <button type="button" className="btn row" disabled={!canEdit} aria-expanded={open} aria-controls={form} onClick={() => { if (!open) onOpen?.(); navigate(open ? '/admin' : `/admin/${form}`) }}>{label}</button>
  </Locked>
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
  return <form className="aform" id="seat" onSubmit={(event) => signIn && complete.mutate({ id: signIn.id, code: formValues(event)('code') })}>
    {start.error
      ? <span className="ferr" role="alert">{start.error.message} <button type="button" className="linkbtn" onClick={() => { started.current = false; start.reset(); navigate('/admin', true) }}>Close</button></span>
      : <span className="mute">{signIn?.url
        ? <>claude.ai opened in a new tab. Press Authorize there (in a full-size window), then paste the code it shows. <a href={signIn.url} target="_blank" rel="noreferrer">Open claude.ai again</a></>
        : <span className="seat-wait"><span className="spin" aria-hidden="true"></span>Starting the Claude sign-in. This takes about 10 seconds.</span>}</span>}
    <div className="inline-form">
      <input name="code" required minLength={10} autoComplete="off" spellCheck={false} aria-label="Code from claude.ai" aria-describedby="seat-error" placeholder="Paste the code from claude.ai" className="mono" disabled={!signIn} autoFocus />
      <button type="button" className="btn sec sm" onClick={() => navigate('/admin', true)}>Cancel</button>
      <button className="btn primary sm" disabled={!signIn || complete.isPending}>{complete.isPending ? 'Connecting…' : 'Connect'}</button>
    </div>
    {complete.error && <span id="seat-error" className="ferr" role="alert">{complete.error.message}</span>}
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
  return <form className="aform" id="public-url" onSubmit={(event) => updateAdmin.mutate({ publicUrl: formValues(event)('publicUrl') })}>
    <span className="mute">The address people open Fast Monkey on. Invite links and the MCP URL use it.</span>
    <div className="inline-form">
      <input name="publicUrl" type="url" required pattern="https?://.+" maxLength={200} defaultValue={publicUrl} aria-label="Public URL" aria-describedby="public-url-error" className="mono" autoFocus />
      <button type="button" className="btn sec sm" onClick={() => navigate('/admin')}>Cancel</button>
      <button className="btn primary sm" disabled={updateAdmin.isPending}>Save</button>
    </div>
    {updateAdmin.error && <span id="public-url-error" className="ferr" role="alert">{updateAdmin.error.message}</span>}
  </form>
}

function ConnectedApps() {
  const apps = useOAuthGrants()
  return <Loaded query={apps}>{(grants) => <AppRows grants={grants} />}</Loaded>
}

function AppRows({ grants }: { grants: OAuthGrant[] }) {
  const deleteGrant = useDeleteOAuthGrant()
  if (!grants.length) return <Row icon="mcp" title="Connected apps" subtitle="No apps yet. Add Fast Monkey to your AI assistant with the prompt on the Agents page." />
  return grants.map((grant) => <Row key={grant.id} icon={appMark(grant.client)} title={grant.client} subtitle={appLine(grant)}
    action={<ConfirmButton className="btn row danger" disabled={deleteGrant.isPending} question={`Disconnect ${grant.client}?`} detail="It can't act as you anymore until you connect it again." action="Disconnect"
      onConfirm={() => deleteGrant.mutate(grant.id, { onError: toastError })}>Disconnect</ConfirmButton>} />)
}

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section className="asec"><div className="ahead"><span className="anum">{String(number).padStart(2, '0')} {title}</span></div><div className="abox">{children}</div></section>
}

function Row({ icon, title, subtitle, mono = false, status, action }: { icon: BrandName; title: string; subtitle: string; mono?: boolean; status?: ReactNode; action?: ReactNode }) {
  return <div className="arow">
    <Mark name={icon} size={40} />
    <span className="t"><span className="atitle">{title}</span><span className={mono ? 'mono asub' : 'asub'}>{subtitle}</span></span>
    {status}{action}
  </div>
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
      action={server.updateAvailable && !updating && <Locked reason={canEdit ? undefined : 'Only an owner or admin updates Fast Monkey'}>
        <button type="button" className="btn primary sm" disabled={!canEdit || startUpdate.isPending} onClick={() => startUpdate.mutate(undefined, { onError: toastError })}>{server.update ? 'Try again' : 'Update now'}</button>
      </Locked>} />
    {updating && <div className="aform updating" role="status"><span className="spin" aria-hidden="true"></span>
      <span>Updating to version <span className="mono">{server.update?.to}</span>. Fast Monkey and its agents restart once. You can leave or refresh; this page follows along.</span></div>}
    {server.update?.status === 'failed' && <div className="aform"><span className="mute" role="status">The last update didn't finish, so Fast Monkey went back to version <span className="mono">{server.build}</span>. Nothing was lost. Details: <code>journalctl -u fastmonkey-update</code> on the server.</span></div>}
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
  if (admin.seat.mode === 'test') return "Test mode: agents use Fast Monkey's test model, not a seat"
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
  return <Dialog labelledBy="containers-h" onClosed={() => navigate('/admin', true)}>{(close) => <div className="dlgform auto">
    <DialogHead id="containers-h" title="Containers" subtitle={<>Straight from <code>docker ps -a</code> on this server, next to what each agent should be doing. Refreshes every 5 seconds.</>} onClose={close} />
    <div className="dlgbody">
      <Loaded query={containers}>{(list) => list.length
        ? <div className="ccards">{list.map((row) => <ContainerCard key={`${row.agentId}-${row.name ?? 'none'}`} row={row} about={about(row.agentId)} />)}</div>
        : <div className="empty">No agent containers on this server.</div>}</Loaded>
    </div>
    <DialogFoot><button type="button" className="btn sec" onClick={close}>Close</button></DialogFoot>
  </div>}</Dialog>
}

function ContainerCard({ row, about }: { row: AgentContainer; about: string | undefined }) {
  const disagree = row.wanted === null || (row.wanted === 'running') !== (row.state === 'running')
  return <div className="box ccard">
    <div className="ccard-top">
      <Avatar id={row.agentId} about={about} size={36} />
      <div className="t"><div className="ellip">{row.agentName ?? 'Deleted agent'}</div><div className="mono mute ellip">{row.name ?? row.agentId}</div></div>
      <span className={`status ${row.state === 'running' ? 'success' : row.state === 'none' ? 'destructive' : 'secondary'}`}>{row.state === 'none' ? 'No container' : row.state}</span>
    </div>
    <div className="facts">
      <div><span>Should be</span><span>{row.wanted ?? 'Agent deleted'}</span></div>
      <div><span>Docker</span><span className="ellip">{row.status}</span></div>
      <div><span>Image</span><span className="mono ellip" title={row.image}>{row.image ? row.image.split('@')[0].split('/').pop() : '—'}</span></div>
      <div><span>Created</span><span className="mono">{row.createdAt ? row.createdAt.slice(0, 16) : '—'}</span></div>
    </div>
    {disagree && <p className="ccard-warn">Docker and Fast Monkey disagree. Reconcile fixes this within 30 seconds while the agent should run.</p>}
  </div>
}
