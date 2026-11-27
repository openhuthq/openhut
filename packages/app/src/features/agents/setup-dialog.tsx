import { useState, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { AiBrain01Icon, Analytics01Icon, ArrowRight01Icon, BookOpen01Icon, Cancel01Icon, Delete02Icon, HistoryIcon, Globe02Icon, Key01Icon, Link01Icon, Notification01Icon, PencilEdit02Icon, PlusSignIcon, Settings02Icon, SourceCodeIcon, UserIcon, WebhookIcon } from '@hugeicons/core-free-icons'
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
import { useChannels, useCreateGrant, useDeleteAgent, useDeleteChannel, useDeleteGrant, useGrants, useMemory, useSkills, useUpdateAgent } from '@/features/agents/api'
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
  { slug: 'general', name: 'General', icon: Settings02Icon },
  { slug: 'connections', name: 'Connections', icon: Link01Icon },
  { slug: 'channels', name: 'Channels', icon: Notification01Icon },
  { slug: 'memory', name: 'Memory', icon: AiBrain01Icon },
  { slug: 'skills', name: 'Skills', icon: BookOpen01Icon },
  { slug: 'routines', name: 'Routines', icon: HistoryIcon },
  { slug: 'webhooks', name: 'Webhooks', icon: WebhookIcon },
] as const

const LINE = 'flex h-[42px] w-full items-center gap-3 text-[13.5px] text-ink no-underline'
const VALUE = 'ml-auto inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-body'
const GROUP = 'flex flex-col [&+&]:mt-2.5 [&+&]:border-t-[0.5px] [&+&]:border-hair [&+&]:pt-2.5'
const REUSED = '-mx-2.5 flex flex-col [&>*]:h-[42px] [&>*]:text-[13.5px]'
const KINDS: Record<ChannelKind, string> = { slack: 'Slack', discord: 'Discord', whatsapp: 'WhatsApp', telegram: 'Telegram' }

export function SetupDialog({ agent, tab, onClose, children }: { agent: Agent; tab: string | undefined; onClose: () => void; children?: ReactNode }) {
  const current = SETUP_TABS.find((each) => each.slug === tab) ?? SETUP_TABS[0]
  return <Dialog label={`Setup · ${agent.name}`} onClose={onClose} className="flex h-[min(560px,calc(100vh-48px))] w-[min(820px,calc(100vw-32px))] overflow-hidden phone:flex-col">
    <nav role="tablist" aria-orientation="vertical" aria-label="Setup" className="flex w-[200px] shrink-0 flex-col gap-0.5 bg-sidebar px-3 py-[22px] phone:w-full phone:flex-row phone:overflow-x-auto phone:py-3">
      <DialogTitle className="truncate px-2.5 pb-4 text-[15px]/[20px] font-semibold phone:hidden">Setup · {agent.name}</DialogTitle>
      {SETUP_TABS.map(({ slug, name, icon }) => <Button key={slug} type="button" variant="bare" role="tab" aria-selected={slug === current.slug}
        onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'setup', detail: slug }), true)}
        className="flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-body hover:bg-hover aria-selected:bg-picked aria-selected:font-medium aria-selected:text-ink [&_svg]:text-mute aria-selected:[&_svg]:text-ink">
        <I icon={icon} size={15} />{name}
      </Button>)}
    </nav>
    <section role="tabpanel" aria-label={current.name} className="relative flex min-h-0 min-w-0 flex-1 flex-col pt-[22px] pb-6 pl-8">
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

function Head({ title, count, action }: { title: string; count?: string; action?: ReactNode }) {
  return <div className="mb-3.5 flex min-h-8 shrink-0 items-center gap-3 pr-[72px]">
    <h2 className="m-0 text-[17px]/[24px] font-semibold">{title}</h2>
    {count && <span className="text-[13px] text-mute">{count}</span>}
    {action && <span className="ml-auto">{action}</span>}
  </div>
}

function Add({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" variant="secondary" className="h-[30px] gap-1.5 rounded-lg px-3 text-[13px] font-medium" disabled={disabled} onClick={onClick}><I icon={PlusSignIcon} size={13} />{label}</Button>
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
    <Head title="General" />
    <Body>
      <div className={GROUP}>
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

function DeleteAgent({ agent }: { agent: Agent }) {
  const deleteAgent = useDeleteAgent(agent.id)
  const { confirming, setConfirming, box } = useConfirming()
  if (!confirming) return <Button type="button" variant="bare" className="mt-1.5 inline-flex h-9 items-center gap-2 self-start text-[13.5px] text-fail" onClick={() => setConfirming(true)}><I icon={Delete02Icon} size={15} />Delete {agent.name}</Button>
  return <div ref={box} className="mt-1.5 flex min-h-9 items-center gap-2">
    <span className="min-w-0 flex-1 text-[13px] text-body">Its chats, memory and skills go with it.</span>
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
    <Head title="Connections" action={agent.canEdit && <Add label="Add app" onClick={() => open('add-app')} />} />
    <p className="m-0 -mt-1.5 mb-3.5 text-[13px] text-mute">What {agent.name} can read and use</p>
    <Body>
      <ErrorNote message={(connections.error ?? grants.error)?.message} />
      {connections.data && !connections.data.length && <p className="m-0 py-2 text-[13px] text-mute">No apps yet. Add one and {agent.name} can use it.</p>}
      {byName(connections.data ?? [], (each) => each.name).map((connection) => {
        const grant = grants.data?.find((each) => each.connectionId === connection.id)
        const label = <><span className="truncate text-[14px] font-medium">{connection.name}</span><span className="truncate text-[12.5px] text-mute">{integration(connection.kind)?.short ?? kindNote(connection)}</span></>
        return <div key={connection.id} className="flex min-h-[54px] items-center gap-3.5">
          <Glyph name={connectionBrand(connection)} size={22} />
          {grant
            ? <Button type="button" variant="bare" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => open(`apps:${connection.id}`)} title={`What ${agent.name} may do`}>{label}</Button>
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
    <Head title="Channels" />
    <Body>
      <ErrorNote message={channels.error?.message} />
      {ORDER.filter((kind) => kind !== 'whatsapp' || features.whatsapp).map((kind) => {
        const channel = channels.data?.find((each) => each.kind === kind)
        return <div key={kind} className={LINE}>
          <Glyph name={kind} size={18} /><span className="min-w-0 flex-1 truncate">{KINDS[kind]}</span>
          {channel?.offline && <span title={channel.offline}><Status tone="bad">Offline</Status></span>}
          {channel?.status === 'connected'
            ? <Switch checked aria-label={`Disconnect ${KINDS[kind]}`} disabled={!agent.canEdit} onCheckedChange={() => setLeaving(kind)} />
            : <Button type="button" variant="secondary" className="h-[30px] rounded-full px-3.5 text-[13px] font-medium" disabled={!agent.canEdit} onClick={() => open(kind)}>{channel ? 'Finish' : 'Connect'}</Button>}
        </div>
      })}
    </Body>
    <ConfirmDialog open={!!gone} onOpenChange={(on) => !on && setLeaving(undefined)} question={`Disconnect ${leaving ? KINDS[leaving] : ''}?`} detail={`${agent.name} stops answering there. Connecting again takes new tokens.`} action="Disconnect"
      onConfirm={() => gone && deleteChannel.mutate(gone, { onError: toastError })} />
  </>
}

function MemoryPane({ agent }: { agent: Agent }) {
  const memory = useMemory(agent.id)
  const people = memory.data?.people.entries ?? []
  const notes = memory.data?.notes.entries ?? []
  const count = people.length + notes.length
  return <>
    <Head title="Memory" count={memory.data ? (count === 1 ? '1 note' : `${count} notes`) : undefined} action={agent.canEdit && <Add label="Add note" onClick={() => open('memory')} />} />
    <Body>
      <ErrorNote message={memory.error?.message} />
      {memory.data && !count && <Empty icon={AiBrain01Icon} title="Nothing saved yet" text={`${agent.name} saves what it learns about you and your team here.`} />}
      {[...people.map((text) => ({ text, icon: UserIcon })), ...notes.map((text) => ({ text, icon: AiBrain01Icon }))].map(({ text, icon }, index) =>
        <Go key={index} icon={icon} label={text} to="memory" chevron="none" />)}
    </Body>
  </>
}

function SkillsPane({ agent }: { agent: Agent }) {
  const skills = useSkills(agent.id)
  const all = skills.data ?? []
  const learned = all.filter((skill) => !skill.builtIn)
  const builtIn = all.length - learned.length
  return <>
    <Head title="Skills" count={skills.data ? String(all.length) : undefined} />
    <Body>
      <ErrorNote message={skills.error?.message} />
      {learned.length > 0 && <div className={GROUP}>{learned.map((skill) => <Go key={skill.id} icon={BookOpen01Icon} label={skill.name} value={<span className="text-[12.5px] text-mute">Learned</span>} to={`skills:${skill.id.slice(agent.id.length + 1)}`} chevron="none" />)}</div>}
      {skills.data && <div className={GROUP}><Go icon={BookOpen01Icon} label="Built-in skills" value={String(builtIn)} to="skills" /></div>}
    </Body>
  </>
}

function RoutinesPane({ agent }: { agent: Agent }) {
  const routines = useRoutines(agent.id)
  const now = new Date()
  return <>
    <Head title="Routines" count={routines.data?.length ? String(routines.data.length) : undefined} />
    <Body>
      <ErrorNote message={routines.error?.message} />
      {routines.data && !routines.data.length && <Empty icon={HistoryIcon} title="Nothing on the list yet" text={`${agent.name} adds routines here when something needs a follow-up.`} />}
      {routines.data?.map((routine) => <Go key={routine.id} icon={HistoryIcon} label={routine.name} to={`routines:${routine.id}`} chevron="none"
        value={<span className="truncate text-[12.5px] text-mute">{routine.stopped ? 'Stopped' : routine.nextRunAt ? nextOf({ at: new Date(routine.nextRunAt), now }) : ''}</span>} />)}
    </Body>
  </>
}

function WebhooksPane({ agent }: { agent: Agent }) {
  const webhooks = useWebhooks(agent.id, agent.canEdit)
  const add = agent.canEdit && <Add label="Add webhook" onClick={() => open('webhooks')} />
  return <>
    <Head title="Webhooks" action={!!webhooks.data?.length && add} />
    <Body>
      <ErrorNote message={webhooks.error?.message} />
      {webhooks.data && !webhooks.data.length && <Empty icon={WebhookIcon} title="No webhooks yet" text={`Let another app start a thread with ${agent.name}, like when a payment fails.`} action={add} />}
      {webhooks.data?.map((webhook) => <Go key={webhook.id} icon={WebhookIcon} label={webhook.name} to="webhooks" chevron="none"
        value={<span className="text-[12.5px] text-mute">{webhook.lastAt ? `Called ${ago(webhook.lastAt)} ago` : 'Not called yet'}</span>} />)}
    </Body>
  </>
}

function Empty({ icon, title, text, action }: { icon: IconSvgElement; title: string; text: string; action?: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-10 text-center">
    <span className="mb-1.5 grid size-11 place-items-center rounded-xl bg-soft text-body"><I icon={icon} size={20} /></span>
    <b className="text-[15px] font-semibold">{title}</b>
    <p className="m-0 max-w-[320px] text-[13px]/[19px] text-mute">{text}</p>
    {action && <span className="mt-2.5">{action}</span>}
  </div>
}
