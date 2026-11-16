import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Automation, AutomationRun, Every, Schedule, SendTarget } from '@openhut/common/automations/automation.ts'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DialogBody, DialogBox, DialogFoot, DialogFrame, DialogHead } from '@/components/ui/dialog'
import { FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ItemGroup, itemVariants } from '@/components/ui/item'
import { NativeSelect } from '@/components/ui/native-select'
import { Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ConfirmButton } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { AUTOMATION_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Tile } from '@/components/mark'
import { Picker } from '@/components/picker'
import { SectionHead } from '@/components/section-head'
import { RunIcon } from '@/components/status-badge'
import { useMe } from '@/features/auth/api'
import { useAutomationRuns, useAutomations, useCreateAutomation, useDeleteAutomation, useRunAutomation, useSendTargets, useUpdateAutomation } from '@/features/automations/api'
import { formValues } from '@/lib/form'
import { ago } from '@/lib/format'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const EVERY: { id: Every; label: string }[] = [{ id: 'hourly', label: 'Hourly' }, { id: 'daily', label: 'Daily' }, { id: 'weekdays', label: 'Weekdays' }, { id: 'weekly', label: 'Weekly' }]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NOWHERE = ''
const MINUTES = ['00', '15', '30', '45']
const WEEK_MS = 6 * 86_400_000

const LAST = 'inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-mute'
const GROUP = 'flex flex-col gap-2'
const LABEL = 'text-xs font-medium text-mute'
const SPLIT = 'flex flex-row items-center justify-between gap-4 border-t border-hair pt-3 phone:flex-wrap'
const WHEN = 'col-start-1 row-start-1 flex flex-col gap-1.5'
const CODE = '[&_code]:font-mono [&_code]:text-[12px] [&_code]:leading-normal [&_code]:font-normal'
const RUN_TEXT = 'm-0 pr-4 pb-3 pl-[42px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-body'

export function AutomationsSection({ agent, lockReason, open }: { agent: Agent; lockReason: string | undefined; open: string | undefined }) {
  const automations = useAutomations(agent.id)
  const opened = automations.data?.find((automation) => automation.id === open)
  const placeName = usePlaceName({ agentId: agent.id, enabled: !!automations.data?.some((automation) => automation.postTo) })
  const add = <Locked reason={lockReason}><Button type="button" size="sm" disabled={!agent.canEdit} onClick={() => navigate(`/agents/${agent.id}/automations/new`)}>{ICONS.plus}Add</Button></Locked>
  return <section>
    <SectionHead title="Automations" action={add} />
    <ErrorNote message={automations.error?.message} />
    {automations.data && !automations.data.length && <p className="m-0 text-mute">{agent.name} only answers when someone writes to it. Add an automation to have it act on a schedule or when another app calls it.</p>}
    {!!automations.data?.length && <ItemGroup>{automations.data.map((automation) => <AutomationRow key={automation.id} agent={agent} automation={automation} lockReason={lockReason} placeName={placeName} />)}</ItemGroup>}
    {open === 'new' && agent.canEdit && <NewAutomationSheet agent={agent} />}
    {opened && <AutomationSheet agent={agent} automation={opened} lockReason={lockReason} placeName={placeName} />}
  </section>
}

function AutomationRow({ agent, automation, lockReason, placeName }: { agent: Agent; automation: Automation; lockReason: string | undefined; placeName: (id: string) => string }) {
  const update = useUpdateAutomation({ agentId: agent.id, automationId: automation.id })
  return <div className={itemVariants()}>
    <Tile className="size-6">{AUTOMATION_ICONS[automation.trigger]}</Tile>
    <a className="group/link flex min-w-0 flex-1 flex-col text-inherit no-underline" href={`/agents/${agent.id}/automations/${automation.id}`}>
      <span className="truncate font-medium group-hover/link:underline">{automation.name}</span>
      <span className="truncate text-xs text-mute">{triggerLine(automation)}{automation.postTo && <> · posts to <PlaceLogo id={automation.postTo} />{placeName(automation.postTo)}</>}</span>
    </a>
    <LastRun automation={automation} />
    <Locked reason={lockReason}>
      <Switch checked={automation.enabled} aria-label={`${automation.name} on`} disabled={!agent.canEdit || update.isPending}
        onCheckedChange={() => update.mutate({ enabled: !automation.enabled }, { onError: toastError })} />
    </Locked>
  </div>
}

function LastRun({ automation }: { automation: Automation }) {
  if (!automation.enabled) return <span className={LAST}><RunIcon status="paused" size={14} />Paused</span>
  if (!automation.lastRun) return <span className={LAST}>Not run yet</span>
  return <span className={LAST}><RunIcon status={automation.lastRun.status} size={14} />{automation.lastRun.status === 'running' ? 'Running' : `Ran ${ago(automation.lastRun.startedAt)} ago`}</span>
}

function NewAutomationSheet({ agent }: { agent: Agent }) {
  const create = useCreateAutomation(agent.id)
  const [trigger, setTrigger] = useState<'schedule' | 'webhook'>('schedule')
  const [every, setEvery] = useState<Every>('weekdays')
  const [enabled, setEnabled] = useState(true)
  const home = `/agents/${agent.id}`
  if (create.data?.webhookSecret) return <WebhookReady agent={agent} automation={create.data} secret={create.data.webhookSecret} />
  const close = () => navigate(home)
  return <Sheet onClose={close}>
    <DialogFrame height="full" onSubmit={(event) => {
      const value = formValues(event)
      const schedule = trigger === 'schedule' ? scheduleFrom({ every, value }) : undefined
      create.mutate({ agentId: agent.id, name: value('name'), instructions: value('instructions'), ...(schedule ? { schedule } : { webhook: true }), postTo: value('postTo') || null, enabled },
        { onSuccess: (automation) => { if (!automation.webhookSecret) close() } })
    }}>
      <DialogHead title="New automation" onClose={close} />
      <DialogBody>
        <Input variant="title" name="name" aria-label="Name" placeholder="Name it, like Morning pipeline digest" required maxLength={80} />
        <div className={GROUP}>
          <span className={LABEL}>Trigger</span>
          <ToggleGroup variant="card" aria-label="Trigger" value={trigger} onPick={(value) => setTrigger(value === 'webhook' ? 'webhook' : 'schedule')}>
            <TriggerCard id="schedule" current={trigger} title="Schedule" line="Runs at set times" />
            <TriggerCard id="webhook" current={trigger} title="Webhook" line="Runs when an app calls it" />
          </ToggleGroup>
          <div className="grid">
            <div className={cn(WHEN, trigger !== 'schedule' && 'invisible')}>
              <ScheduleFields every={every} onEvery={setEvery} />
            </div>
            <div className={cn(WHEN, trigger !== 'webhook' && 'invisible')}>
              <Alert variant="dashed">{AUTOMATION_ICONS.webhook}You get the URL and secret after you create it. The secret is shown once.</Alert>
              <FieldDescription className={CODE}>Callers send <code>POST</code> with <code>Authorization: Bearer &lt;secret&gt;</code>. The body goes to {agent.name} with the instructions.</FieldDescription>
            </div>
          </div>
        </div>
        <label className={GROUP}><span className={LABEL}>Instructions</span>
          <Textarea name="instructions" required maxLength={5000} placeholder={`What should ${agent.name} do each time? Say when to stay quiet, like "If nothing changed, say nothing."`} />
        </label>
        <div className={SPLIT}>
          <div><span className={LABEL}>Post the result</span><FieldDescription className="mt-0.5 block">Optional. Every run is kept either way.</FieldDescription></div>
          <PostToPicker agent={agent} value={NOWHERE} />
        </div>
        <div className={SPLIT}>
          <div><span className={LABEL}>On</span><FieldDescription className="mt-0.5 block">{enabled ? 'Starts running as soon as it\'s created.' : 'Stays paused until you turn it on.'}</FieldDescription></div>
          <Switch checked={enabled} aria-label="On" onCheckedChange={setEnabled} />
        </div>
      </DialogBody>
      <DialogFoot error={create.error?.message}>
        <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>Create automation</Button>
      </DialogFoot>
    </DialogFrame>
  </Sheet>
}

function TriggerCard({ id, current, title, line }: { id: 'schedule' | 'webhook'; current: string; title: string; line: string }) {
  return <ToggleGroupItem value={id}>
    <Tile tone={current === id ? 'ink' : 'quiet'} className="size-6">{AUTOMATION_ICONS[id]}</Tile><span className="flex flex-col text-xs"><b className="text-sm font-medium">{title}</b><span className="text-mute">{line}</span></span>
  </ToggleGroupItem>
}

function ScheduleFields({ every, onEvery, initial }: { every: Every; onEvery: (every: Every) => void; initial?: Schedule }) {
  const me = useMe()
  const zone = me.data?.timeZone ? ` (${me.data.timeZone})` : ''
  return <div className="flex flex-wrap items-center gap-1.5">
    <ToggleGroup variant="pill" className="contents" aria-label="How often" value={every} onPick={(value) => onEvery(EVERY.find((option) => option.id === value)?.id ?? every)}>
      {EVERY.map((option) => <ToggleGroupItem key={option.id} value={option.id}>{option.label}</ToggleGroupItem>)}
    </ToggleGroup>
    {every === 'weekly' && <NativeSelect name="day" aria-label="Day" defaultValue={initial?.day ?? 1}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</NativeSelect>}
    {every === 'hourly'
      ? <NativeSelect name="minute" aria-label="Minute past the hour" defaultValue={initial?.at.slice(3) ?? '00'}>{[...new Set([...MINUTES, initial?.at.slice(3) ?? '00'])].sort().map((minute) => <option key={minute} value={minute}>:{minute}</option>)}</NativeSelect>
      : <Input variant="chip" type="time" name="at" aria-label="Time" defaultValue={initial?.at ?? '09:00'} required />}
    <FieldDescription className="basis-full">{every === 'hourly' ? 'Runs every hour at that minute.' : `Server time${zone}.`}</FieldDescription>
  </div>
}

function scheduleFrom({ every, value }: { every: Every; value: (name: string) => string }): Schedule {
  const at = every === 'hourly' ? `00:${value('minute') || '00'}` : value('at') || '09:00'
  return { every, at, ...(every === 'weekly' && { day: Number(value('day')) }) }
}

function PostToPicker({ agent, value }: { agent: Agent; value: string }) {
  const targets = useSendTargets({ agentId: agent.id, enabled: true })
  const [chosen, setChosen] = useState(value)
  const known = targets.data ?? []
  const listed: SendTarget[] = value && !known.some((target) => target.id === value) ? [...known, { id: value, object: 'send_target', platform: value.split(':')[0], name: value, type: '' }] : known
  const options = [{ id: NOWHERE, label: 'Don\'t post', blurb: 'Every run is kept either way' }, ...listed.map((target) => ({ id: target.id, label: target.name, blurb: `${platformName(target.platform)}${target.type ? ` · ${target.type}` : ''}` }))]
  return <div className="max-w-[60%] min-w-[220px] phone:w-full phone:max-w-none">
    <Picker name="Post the result to" formName="postTo" triggerClassName="w-full" options={options} value={chosen} disabled={false} lockReason={undefined} onChoose={setChosen}
      iconOf={(id, size) => id ? <PlaceLogo id={id} size={size} /> : AUTOMATION_ICONS.off}
      note={targets.data && !known.length ? emptyNote(agent) : undefined} />
  </div>
}

function emptyNote(agent: Agent): string {
  return agent.status === 'running' ? 'No channels yet. Connect Slack, Telegram or WhatsApp to post the result.' : `Start ${agent.name} to see where it can post.`
}

function PlaceLogo({ id, size = 12 }: { id: string; size?: number }) {
  const platform = id.split(':')[0]
  return isBrand(platform) ? <span className="mr-1 inline-flex align-[-2px]"><Glyph name={platform} size={size} /></span> : null
}

function isBrand(name: string): name is BrandName {
  return Object.hasOwn(BRAND_ICONS, name)
}

const PLATFORM_NAMES: Record<string, string> = { slack: 'Slack', telegram: 'Telegram', whatsapp: 'WhatsApp' }

function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1)
}

function WebhookReady({ agent, automation, secret }: { agent: Agent; automation: Automation; secret: string }) {
  const home = `/agents/${agent.id}`
  const close = () => navigate(home)
  return <Sheet dismissable={false} onClose={close}>
    <DialogBox height="full">
      <DialogHead title={`${automation.name} is ready`} subtitle="Copy the secret now. It isn't shown again." onClose={close} />
      <DialogBody>
        <div className={GROUP}><span className={LABEL}>Webhook URL</span><SecretRow text={automation.webhookUrl ?? ''} /></div>
        <div className={GROUP}><span className={LABEL}>Secret</span><SecretRow text={secret} /></div>
        <FieldDescription className={CODE}>Send <code>POST {automation.webhookUrl}</code> with the header <code>Authorization: Bearer {'<secret>'}</code> and any JSON body.</FieldDescription>
      </DialogBody>
      <DialogFoot><Button type="button" variant="primary" onClick={close}>Done</Button></DialogFoot>
    </DialogBox>
  </Sheet>
}

function SecretRow({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-hair bg-tint py-1 pr-1 pl-3"><code className="min-w-0 flex-1 font-mono text-[12px] leading-normal font-normal break-all">{text}</code><CopyButton text={text} label="Copy" /></div>
}

function AutomationSheet({ agent, automation, lockReason, placeName }: { agent: Agent; automation: Automation; lockReason: string | undefined; placeName: (id: string) => string }) {
  const [editing, setEditing] = useState(false)
  const me = useMe()
  const runs = useAutomationRuns(automation.id)
  const run = useRunAutomation({ agentId: agent.id, automationId: automation.id })
  const remove = useDeleteAutomation({ agentId: agent.id, automationId: automation.id })
  const update = useUpdateAutomation({ agentId: agent.id, automationId: automation.id })
  const [every, setEvery] = useState<Every>(automation.schedule?.every ?? 'daily')
  const busy = runs.data?.some((each) => each.status === 'running') || run.isPending
  const home = `/agents/${agent.id}`
  const close = () => navigate(home)
  return <Sheet onClose={close}>{editing
    ? <DialogFrame height="full" onSubmit={(event) => {
      const value = formValues(event)
      const schedule = automation.schedule ? scheduleFrom({ every, value }) : undefined
      update.mutate({ name: value('name'), instructions: value('instructions'), postTo: value('postTo') || null, ...(schedule && { schedule }) }, { onSuccess: () => setEditing(false) })
    }}>
      <DialogHead title={`Edit ${automation.name}`} onClose={close} />
      <DialogBody>
        <Input variant="title" name="name" aria-label="Name" required maxLength={80} defaultValue={automation.name} />
        {automation.schedule && <div className={GROUP}><span className={LABEL}>Schedule</span><ScheduleFields every={every} onEvery={setEvery} initial={automation.schedule} /></div>}
        <label className={GROUP}><span className={LABEL}>Instructions</span><Textarea name="instructions" required maxLength={5000} defaultValue={automation.instructions} /></label>
        <div className={SPLIT}><div><span className={LABEL}>Post the result</span><FieldDescription className="mt-0.5 block">Optional. Every run is kept either way.</FieldDescription></div><PostToPicker agent={agent} value={automation.postTo ?? NOWHERE} /></div>
      </DialogBody>
      <DialogFoot error={update.error?.message}>
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={update.isPending}>Save</Button>
      </DialogFoot>
    </DialogFrame>
    : <DialogBox height="full">
      <DialogHead title={automation.name} subtitle={<>{triggerLine(automation)}{automation.postTo && <> · posts to <PlaceLogo id={automation.postTo} />{placeName(automation.postTo)}</>}</>} onClose={close} />
      <DialogBody>
        {automation.webhookUrl && <div className={GROUP}><span className={LABEL}>Webhook URL</span><SecretRow text={automation.webhookUrl} /></div>}
        <div className={GROUP}><span className={LABEL}>Runs</span>
          <ErrorNote message={runs.error?.message} />
          {runs.data && !runs.data.length && <p className="m-0 text-mute">No runs yet. {automation.trigger === 'schedule' && automation.nextRunAt ? `The first is ${when({ iso: automation.nextRunAt, timeZone: me.data?.timeZone })}.` : ''}</p>}
          {!!runs.data?.length && <ItemGroup>{runs.data.map((each) => <RunRow key={each.id} run={each} />)}</ItemGroup>}
        </div>
      </DialogBody>
      <DialogFoot error={run.error?.message} start={<Locked reason={lockReason}>
        <ConfirmButton disabled={!agent.canEdit || remove.isPending} question={`Delete ${automation.name}?`} detail={automation.webhookUrl ? 'Its webhook URL stops working. This can\'t be undone.' : 'This can\'t be undone.'} action="Delete"
          onConfirm={() => remove.mutate(undefined, { onSuccess: close, onError: toastError })}>Delete</ConfirmButton>
      </Locked>}>
        <Locked reason={lockReason}><Button type="button" variant="secondary" disabled={!agent.canEdit} onClick={() => setEditing(true)}>Edit</Button></Locked>
        <Locked reason={lockReason}><Button type="button" variant="primary" disabled={!agent.canEdit || busy} onClick={() => run.mutate()}>{busy ? 'Running…' : 'Run now'}</Button></Locked>
      </DialogFoot>
    </DialogBox>}
  </Sheet>
}

function RunRow({ run }: { run: AutomationRun }) {
  const timeZone = useMe().data?.timeZone
  const detail = run.error ?? run.answer
  return <Collapsible>
    <CollapsibleTrigger className={cn(itemVariants(), 'w-full gap-2.5 border-0 bg-transparent text-left not-disabled:hover:bg-tint')} disabled={!detail}>
      <RunIcon status={run.status} />
      <span className="w-24 shrink-0 whitespace-nowrap">{when({ iso: run.startedAt, timeZone })}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-mute">{summary(run)}</span>
      <span className="w-8 text-right text-xs text-mute tabular-nums">{run.ms === null ? '' : `${Math.round(run.ms / 1000)}s`}</span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      {run.error && <p className={RUN_TEXT}>{run.error}</p>}
      {!run.error && run.answer && <div className={cn(RUN_TEXT, 'msg-t')}><Markdown remarkPlugins={[remarkGfm]}>{run.answer}</Markdown></div>}
    </CollapsibleContent>
  </Collapsible>
}

function summary(run: AutomationRun): string {
  if (run.status === 'running') return 'Running'
  if (run.status === 'quiet') return 'Nothing new, didn\'t post'
  if (run.status === 'done') return plain(run.answer ?? 'Done')
  return run.error ?? run.status
}

function triggerLine(automation: Automation): string {
  if (!automation.schedule) return 'From a webhook'
  const { every, at, day } = automation.schedule
  if (every === 'hourly') return `Hourly at :${at.slice(3)}`
  if (every === 'weekly') return `${DAYS[day ?? 1]}s at ${at}`
  return `${every === 'daily' ? 'Daily' : 'Weekdays'} at ${at}`
}

function usePlaceName({ agentId, enabled }: { agentId: string; enabled: boolean }): (id: string) => string {
  const targets = useSendTargets({ agentId, enabled })
  return (id) => {
    const target = targets.data?.find((each) => each.id === id)
    return target ? label(target) : id
  }
}

function label(target: SendTarget): string {
  return `${platformName(target.platform)} · ${target.name}`
}

function when({ iso, timeZone }: { iso: string; timeZone: string | undefined }): string {
  const date = new Date(iso)
  const far = Math.abs(Date.now() - date.getTime()) > WEEK_MS
  const day: Intl.DateTimeFormatOptions = far ? { month: 'short', day: 'numeric' } : { weekday: 'short' }
  return date.toLocaleString('en', { ...day, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
}

function plain(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
}
