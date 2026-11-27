import { useState, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { AiBrain01Icon, Analytics01Icon, ArrowRight01Icon, BookOpen01Icon, Cancel01Icon, Delete02Icon, Globe02Icon, HistoryIcon, Key01Icon, Link01Icon, Notification01Icon, PencilEdit02Icon, PlayIcon, PlusSignIcon, Settings02Icon, SourceCodeIcon, StopIcon, WebhookIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { ChannelKind } from '@openhut/common/channels/channel.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog, useConfirming } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, PILL, ROW, Status } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { AccessPicker } from '@/features/agents/access'
import { Face } from '@/features/agents/face'
import { MemoryEditor } from '@/features/agents/memory-dialog'
import { SkillsBrowser, type Crumb } from '@/features/agents/skills-dialog'
import { useChannels, useCreateGrant, useDeleteAgent, useDeleteChannel, useDeleteGrant, useGrants, useUpdateAgent } from '@/features/agents/api'
import { ORDER } from '@/features/agents/channel-kinds'
import { ModelRows } from '@/features/agents/model-rows'
import { RunsOnRow } from '@/features/agents/move'
import { useFeatures } from '@/features/computers/api'
import { useConnections } from '@/features/connections/api'
import { byName, connectionBrand, integration, kindNote } from '@/features/connections/catalog'
import { useRoutines } from '@/features/routines/api'
import { nextOf } from '@/features/routines/when'
import { useNotify } from '@/features/agents/notify'
import { placeName } from '@/features/threads/places'
import { useWebhooks } from '@/features/webhooks/api'
import { ago } from '@/lib/format'
import { navigate, open } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useMoreBelow } from '@/lib/more-below'

const SETUP_TABS = [
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate' },
  { slug: 'connections', name: 'Connections', icon: Link01Icon, hue: 'text-hue-red' },
  { slug: 'channels', name: 'Channels', icon: Notification01Icon, hue: 'text-hue-blue' },
  { slug: 'memory', name: 'Memory', icon: AiBrain01Icon, hue: 'text-hue-violet' },
  { slug: 'skills', name: 'Skills', icon: BookOpen01Icon, hue: 'text-hue-amber' },
  { slug: 'routines', name: 'Routines', icon: HistoryIcon, hue: 'text-hue-green' },
  { slug: 'webhooks', name: 'Webhooks', icon: WebhookIcon, hue: 'text-hue-sky' },
] as const

const LINE = 'flex h-[42px] w-full items-center gap-3 text-[13.5px] text-ink no-underline'
const VALUE = 'ml-auto inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-body'
const GROUP = 'flex flex-col [&+&]:mt-2.5 [&+&]:border-t-[0.5px] [&+&]:border-hair [&+&]:pt-2.5'
const REUSED = '-mx-2.5 flex flex-col [&>*]:h-[42px] [&>*]:text-[13.5px]'
const KINDS: Record<ChannelKind, string> = { slack: 'Slack', discord: 'Discord', whatsapp: 'WhatsApp', telegram: 'Telegram' }

export function SetupDialog({ agent, tab, onClose, children }: { agent: Agent; tab: string | undefined; onClose: () => void; children?: ReactNode }) {
  const current = SETUP_TABS.find((each) => each.slug === tab) ?? SETUP_TABS[0]
  return <Dialog size="window" label={`Setup · ${agent.name}`} onClose={onClose} className="flex overflow-hidden phone:flex-col">
    <nav role="tablist" aria-orientation="vertical" aria-label="Setup" className="no-scrollbar flex w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar px-3 py-4 phone:w-full phone:flex-row phone:overflow-x-auto phone:py-3">
      <DialogTitle className="sr-only">{`Setup · ${agent.name}`}</DialogTitle>
      {SETUP_TABS.map(({ slug, name, icon, hue }) => <Button key={slug} type="button" variant="bare" role="tab" aria-selected={slug === current.slug}
        onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'setup', detail: slug }), true)}
        className="flex shrink-0 items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px]/[18px] text-ink hover:bg-hover aria-selected:bg-picked">
        <I icon={icon} size={18} className={hue} />{name}
      </Button>)}
    </nav>
    <section role="tabpanel" aria-label={current.name} className="relative flex min-h-0 min-w-0 flex-1 flex-col pt-[26px] pb-6 pl-[34px]">
      <Button type="button" size="icon" aria-label="Close" title="Close (Esc)" className="absolute top-2.5 right-2.5 z-10 rounded-full text-mute" onClick={onClose}><I icon={Cancel01Icon} size={16} /></Button>
      <Pane agent={agent} tab={current.slug} />
    </section>
    {children}
  </Dialog>
}

function Pane({ agent, tab }: { agent: Agent; tab: typeof SETUP_TABS[number]['slug'] }) {
  switch (tab) {
    case 'connections': return <ConnectionsPane agent={agent} />
    case 'channels': return <ChannelsPane agent={agent} />
    case 'memory': return <MemoryPane agent={agent} />
    case 'skills': return <SkillsPane agent={agent} />
    case 'routines': return <RoutinesPane agent={agent} />
    case 'webhooks': return <WebhooksPane agent={agent} />
    default: return <GeneralPane agent={agent} />
  }
}

function Head({ title, subtitle, count, action, crumb }: { title: string; subtitle: string; count?: string; action?: ReactNode; crumb?: Crumb }) {
  return <div className="flex shrink-0 flex-col">
    {crumb
      ? <h2 className="m-0 flex min-w-0 items-center gap-1.5 pr-[52px] text-[15px]/[22px] font-medium"><Button type="button" variant="bare" className="h-auto p-0 text-[15px] font-medium text-mute hover:text-ink" onClick={crumb.onBack}>{title}</Button><I icon={ArrowRight01Icon} size={13} className="shrink-0 text-mute-2" /><span className="min-w-0 truncate">{crumb.label}</span></h2>
      : <h2 className="m-0 pr-[52px] text-[15px]/[22px] font-medium">{title}</h2>}
    <p className="m-0 pr-[52px] text-[12.5px]/[18px] text-mute">{subtitle}</p>
    {(count || action) && <div className="mt-[18px] mb-1.5 flex min-h-[26px] items-center pr-8 text-[12px]/[16px] text-mute">{count}<span className="ml-auto">{action}</span></div>}
    {!count && !action && <div className="h-[18px]" />}
  </div>
}

function Add({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" variant="primary" className={cn(PILL, 'gap-1')} disabled={disabled} onClick={onClick}><I icon={PlusSignIcon} size={14} />{label}</Button>
}

function Body({ children }: { children: ReactNode }) {
  const { ref, more } = useMoreBelow<HTMLDivElement>()
  return <div ref={ref} className={cn('no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pr-8 pb-2', more && 'fade-b')}>{children}</div>
}

function Go({ icon, label, value, to, chevron = 'go' }: { icon: IconSvgElement; label: string; value?: ReactNode; to: string; chevron?: 'go' | 'none' }) {
  return <Button type="button" variant="bare" className={cn(LINE, 'rounded-md hover:bg-hover -mx-2.5 w-[calc(100%+20px)] px-2.5')} onClick={() => open(to)}>
    <I icon={icon} size={15} className="text-mute" /><span className="min-w-0 truncate">{label}</span>
    <span className={VALUE}>{value}{chevron === 'go' && <I icon={ArrowRight01Icon} size={12} className="shrink-0 text-mute" />}</span>
  </Button>
}

function GeneralPane({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  const features = useFeatures(agent.runsOn ?? undefined)
  const change = (patch: Parameters<typeof updateAgent.mutate>[0]) => updateAgent.mutate(patch, { onError: toastError })
  const browser = features.browser || agent.browser
  return <>
    <Head title="General" subtitle={`How ${agent.name} works and who can use it`} />
    <Body>
      <div className={GROUP}>
        <Button type="button" variant="bare" disabled={!agent.canEdit} onClick={() => open('customize')} className="-mx-2.5 mb-1 flex w-[calc(100%+20px)] items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-hover disabled:hover:bg-transparent">
          <Face agent={agent} size={44} />
          <span className="grid min-w-0 flex-1"><span className="truncate text-[15px]/[20px] font-medium text-ink">{agent.name}</span><span className="text-[12.5px] text-mute">Name and picture</span></span>
          {agent.canEdit && <span className={VALUE}>Edit<I icon={ArrowRight01Icon} size={12} className="shrink-0 text-mute" /></span>}
        </Button>
        <Go icon={PencilEdit02Icon} label="What it does" value={<span className="max-w-[300px] truncate">{agent.summary || 'Not set yet'}</span>} to="does" />
        <div className={REUSED}>
          <ModelRows agent={agent} />
          <RunsOnRow agent={agent} />
          <AccessPicker owner={agent.owner ?? agent.ownerId} value={{ shared: agent.shared, people: agent.people }} title="Who can use it" className={cn(ROW, 'data-disabled:hover:bg-transparent')} disabled={!agent.canManage}
            onChange={(access) => updateAgent.mutate(access, { onError: toastError })} />
        </div>
      </div>
      <div className={GROUP}>
        {agent.canManage && <label className={LINE}><I icon={SourceCodeIcon} size={15} className="text-mute" />Run code<Switch className="ml-auto" checked={agent.codeExecution} aria-label="Run code" disabled={!agent.canEdit || updateAgent.isPending} onCheckedChange={() => change({ codeExecution: !agent.codeExecution })} /></label>}
        <label className={LINE} title={browser ? undefined : 'This computer can’t give agents a browser.'}><I icon={Globe02Icon} size={15} className="text-mute" />Browser
          {!browser && <span className="ml-auto text-[12.5px] text-mute">Not on this computer</span>}
          <Switch className={cn(browser && 'ml-auto')} checked={agent.browser} aria-label="Browser" disabled={!browser || !agent.canEdit || updateAgent.isPending} onCheckedChange={() => change({ browser: !agent.browser })} /></label>
        {agent.canEdit && <NotifyLine agent={agent} />}
      </div>
      <div className={GROUP}>
        <Go icon={Analytics01Icon} label="Activity" to="activity" />
        <Go icon={Key01Icon} label="Keys" to="keys" />
        {agent.canEdit && <StopStart agent={agent} />}
        {agent.canEdit && agent.canManage && <DeleteAgent agent={agent} />}
      </div>
    </Body>
  </>
}

function NotifyLine({ agent }: { agent: Agent }) {
  const notify = useNotify(agent.id)
  if (notify.isError) return null
  const place = notify.data?.default
  return <Go icon={Notification01Icon} label="Notify me" value={notify.data && <span className="truncate">{place ? placeName(place) : 'Here'}</span>} to="notify" />
}

function StopStart({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  const running = agent.wanted === 'running'
  return <Button type="button" variant="bare" className={cn(LINE, 'rounded-md hover:bg-hover -mx-2.5 w-[calc(100%+20px)] px-2.5')} disabled={updateAgent.isPending}
    onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}>
    <I icon={running ? StopIcon : PlayIcon} size={15} className={running ? 'text-hue-red' : 'text-hue-green'} />{running ? 'Stop' : 'Start'}
    <span className={VALUE}>{running ? 'Running' : 'Stopped'}</span>
  </Button>
}

function DeleteAgent({ agent }: { agent: Agent }) {
  const deleteAgent = useDeleteAgent(agent.id)
  const { confirming, setConfirming, box } = useConfirming()
  if (!confirming) return <Button type="button" variant="bare" aria-label={`Delete ${agent.name}`} className="mt-1.5 inline-flex h-9 items-center gap-2 self-start text-[13.5px] text-fail" onClick={() => setConfirming(true)}><I icon={Delete02Icon} size={15} />Delete</Button>
  return <div ref={box} className="mt-1.5 flex min-h-9 items-center gap-2">
    <span className="min-w-0 flex-1 text-[13px]/[18px] text-body">Delete {agent.name}? Its chats, memory and skills go with it.</span>
    <Button type="button" variant="secondary" className={PILL} autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
    <Button type="button" variant="destructive" className={PILL} disabled={deleteAgent.isPending} onClick={() => deleteAgent.mutate(undefined, { onError: toastError })}>Delete</Button>
  </div>
}

function ConnectionsPane({ agent }: { agent: Agent }) {
  const connections = useConnections()
  const grants = useGrants({ agentId: agent.id })
  const createGrant = useCreateGrant()
  const deleteGrant = useDeleteGrant()
  const busy = createGrant.isPending || deleteGrant.isPending
  return <>
    <Head title="Connections" subtitle={`Apps ${agent.name} can read and use`} count={connections.data ? (connections.data.length ? countOf(grants.data?.length ?? 0, 'app on', 'apps on') : 'No apps yet') : undefined} action={agent.canEdit && <Add label="Add app" onClick={() => open('add-app')} />} />
    <Body>
      <ErrorNote message={(connections.error ?? grants.error)?.message} />
      {byName(connections.data ?? [], (each) => each.name).map((connection) => {
        const grant = grants.data?.find((each) => each.connectionId === connection.id)
        const label = <><span className="truncate text-[14px] font-medium">{connection.name}</span><span className="truncate text-[12.5px] text-mute">{integration(connection.kind)?.short ?? kindNote(connection)}</span></>
        return <div key={connection.id} className="flex min-h-[54px] items-center gap-3.5">
          <Glyph name={connectionBrand(connection)} size={22} />
          {grant
            ? <Button type="button" variant="bare" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => open(`apps:${connection.id}`)} title="Permissions">{label}</Button>
            : <span className="grid min-w-0 flex-1 gap-0.5">{label}</span>}
          <Switch checked={!!grant} aria-label={`${agent.name} can use ${connection.name}`} disabled={!agent.canEdit || busy}
            onCheckedChange={(on) => on ? createGrant.mutate({ agentId: agent.id, connectionId: connection.id }, { onError: toastError }) : grant && deleteGrant.mutate(grant, { onError: toastError })} />
        </div>
      })}
    </Body>
  </>
}

function ChannelsPane({ agent }: { agent: Agent }) {
  const channels = useChannels(agent.id)
  const features = useFeatures(agent.runsOn ?? undefined)
  const deleteChannel = useDeleteChannel()
  const [leaving, setLeaving] = useState<ChannelKind>()
  const gone = channels.data?.find((each) => each.kind === leaving)
  return <>
    <Head title="Channels" subtitle={`Where people talk to ${agent.name}`} count={channels.data ? countOf(channels.data.filter((each) => each.status === 'connected').length, 'connected', 'connected') : undefined} />
    <Body>
      <ErrorNote message={channels.error?.message} />
      {ORDER.map((kind) => {
        const channel = channels.data?.find((each) => each.kind === kind)
        return <div key={kind} className={LINE}>
          <Glyph name={kind} size={18} /><span className="min-w-0 flex-1 truncate">{KINDS[kind]}</span>
          {channel?.offline && <span title={channel.offline}><Status tone="bad">Offline</Status></span>}
          {channel?.status === 'connected' && <Switch checked aria-label={`Disconnect ${KINDS[kind]}`} disabled={!agent.canEdit} onCheckedChange={() => setLeaving(kind)} />}
          {channel?.status !== 'connected' && kind === 'whatsapp' && !features.whatsapp && <span className="text-[12.5px] text-mute" title="This computer can’t run the WhatsApp bridge.">Not on this computer</span>}
          {channel?.status !== 'connected' && (kind !== 'whatsapp' || features.whatsapp) && <Button type="button" variant="ghost" size="sm" disabled={!agent.canEdit} onClick={() => open(kind)}>{channel ? 'Finish' : 'Connect'}</Button>}
        </div>
      })}
    </Body>
    <ConfirmDialog open={!!gone} onOpenChange={(on) => !on && setLeaving(undefined)} question={`Disconnect ${leaving ? KINDS[leaving] : ''}?`} detail={`${agent.name} stops answering there. Connecting again takes new tokens.`} action="Disconnect"
      onConfirm={() => gone && deleteChannel.mutate(gone, { onError: toastError })} />
  </>
}

function MemoryPane({ agent }: { agent: Agent }) {
  return <div className="flex min-h-0 flex-1 flex-col"><MemoryEditor agent={agent} head={(crumb) => <Head title="Memory" subtitle={`What ${agent.name} remembers`} crumb={crumb} />} /></div>
}

function SkillsPane({ agent }: { agent: Agent }) {
  return <div className="flex min-h-0 flex-1 flex-col"><SkillsBrowser agent={agent} head={(crumb) => <Head title="Skills" subtitle={`What ${agent.name} knows how to do`} crumb={crumb} />} /></div>
}

function RoutinesPane({ agent }: { agent: Agent }) {
  const routines = useRoutines(agent.id)
  const now = new Date()
  return <>
    <Head title="Routines" subtitle={`What ${agent.name} does on a schedule`} count={routines.data ? countOf(routines.data.length, 'routine', 'routines') : undefined} />
    <Body>
      <ErrorNote message={routines.error?.message} />
      {routines.data && !routines.data.length && <Empty icon={HistoryIcon} title="No routines yet" />}
      {routines.data?.map((routine) => <Go key={routine.id} icon={HistoryIcon} label={routine.name} to={`routines:${routine.id}`} chevron="none"
        value={<span className="truncate text-[12.5px] text-mute">{routine.stopped ? 'Stopped' : routine.nextRunAt ? nextOf({ at: new Date(routine.nextRunAt), now }) : ''}</span>} />)}
    </Body>
  </>
}

function WebhooksPane({ agent }: { agent: Agent }) {
  const webhooks = useWebhooks(agent.id, agent.canEdit)
  const add = agent.canEdit && <Add label="Add webhook" onClick={() => open('webhooks')} />
  return <>
    <Head title="Webhooks" subtitle={`Apps that start a thread with ${agent.name}`} count={webhooks.data ? countOf(webhooks.data.length, 'webhook', 'webhooks') : undefined} action={add} />
    <Body>
      <ErrorNote message={webhooks.error?.message} />
      {webhooks.data && !webhooks.data.length && <Empty icon={WebhookIcon} title="No webhooks yet" />}
      {webhooks.data?.map((webhook) => <Go key={webhook.id} icon={WebhookIcon} label={webhook.name} to="webhooks" chevron="none"
        value={<span className="text-[12.5px] text-mute">{webhook.lastAt ? `Called ${ago(webhook.lastAt)} ago` : 'Not called yet'}</span>} />)}
    </Body>
  </>
}

function countOf(n: number, one: string, many: string) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

function Empty({ icon, title, action }: { icon: IconSvgElement; title: string; action?: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-10 text-center">
    <span className="mb-1.5 grid size-11 place-items-center rounded-xl bg-soft text-body"><I icon={icon} size={20} /></span>
    <b className="text-[15px] font-semibold">{title}</b>
    {action && <span className="mt-2.5">{action}</span>}
  </div>
}
