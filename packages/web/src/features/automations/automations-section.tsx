import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Automation, AutomationRun, Every, Schedule, SendTarget } from '@openhut/common/automations/automation.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { ErrorNote } from '@/components/error-note'
import { AUTOMATION_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { RunIcon } from '@/components/status-badge'
import { useMe } from '@/features/auth/api'
import { useAutomationRuns, useAutomations, useCreateAutomation, useDeleteAutomation, useRunAutomation, useSendTargets, useUpdateAutomation } from '@/features/automations/api'
import { formValues } from '@/lib/form'
import { ago } from '@/lib/format'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const EVERY: { id: Every; label: string }[] = [{ id: 'hourly', label: 'Hourly' }, { id: 'daily', label: 'Daily' }, { id: 'weekdays', label: 'Weekdays' }, { id: 'weekly', label: 'Weekly' }]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NOWHERE = ''
const MINUTES = ['00', '15', '30', '45']
const WEEK_MS = 6 * 86_400_000

export function AutomationsSection({ agent, lockReason, open }: { agent: Agent; lockReason: string | undefined; open: string | undefined }) {
  const automations = useAutomations(agent.id)
  const opened = automations.data?.find((automation) => automation.id === open)
  const placeName = usePlaceName({ agentId: agent.id, enabled: !!automations.data?.some((automation) => automation.postTo) })
  const add = <Locked reason={lockReason}><button type="button" className="btn sm" disabled={!agent.canEdit} onClick={() => navigate(`/agents/${agent.id}/automations/new`)}>{ICONS.plus}Add</button></Locked>
  return <section>
    <SectionHead title="Automations" action={add} />
    <ErrorNote message={automations.error?.message} />
    {automations.data && !automations.data.length && <p className="note">{agent.name} only answers when someone writes to it. Add an automation to have it act on a schedule or when another app calls it.</p>}
    {!!automations.data?.length && <div className="box rows">{automations.data.map((automation) => <AutomationRow key={automation.id} agent={agent} automation={automation} lockReason={lockReason} placeName={placeName} />)}</div>}
    {open === 'new' && agent.canEdit && <NewAutomationSheet agent={agent} />}
    {opened && <AutomationSheet agent={agent} automation={opened} lockReason={lockReason} placeName={placeName} />}
  </section>
}

function AutomationRow({ agent, automation, lockReason, placeName }: { agent: Agent; automation: Automation; lockReason: string | undefined; placeName: (id: string) => string }) {
  const update = useUpdateAutomation({ agentId: agent.id, automationId: automation.id })
  return <div className="row autorow">
    <span className="mark">{AUTOMATION_ICONS[automation.trigger]}</span>
    <a className="alink" href={`/agents/${agent.id}/automations/${automation.id}`}>
      <span className="ellip aname-l">{automation.name}</span>
      <span className="mute ellip">{triggerLine(automation)}{automation.postTo ? ` · posts to ${placeName(automation.postTo)}` : ''}</span>
    </a>
    <LastRun automation={automation} />
    <Locked reason={lockReason}>
      <button className="sw" role="switch" aria-checked={automation.enabled} aria-label={`${automation.name} on`} disabled={!agent.canEdit || update.isPending}
        onClick={() => update.mutate({ enabled: !automation.enabled }, { onError: toastError })}></button>
    </Locked>
  </div>
}

function LastRun({ automation }: { automation: Automation }) {
  if (!automation.enabled) return <span className="mute last"><RunIcon status="paused" size={14} />Paused</span>
  if (!automation.lastRun) return <span className="mute last">Not run yet</span>
  return <span className="mute last"><RunIcon status={automation.lastRun.status} size={14} />{automation.lastRun.status === 'running' ? 'Running' : `Ran ${ago(automation.lastRun.startedAt)} ago`}</span>
}

function NewAutomationSheet({ agent }: { agent: Agent }) {
  const create = useCreateAutomation(agent.id)
  const [trigger, setTrigger] = useState<'schedule' | 'webhook'>('schedule')
  const [every, setEvery] = useState<Every>('weekdays')
  const [enabled, setEnabled] = useState(true)
  const home = `/agents/${agent.id}`
  if (create.data?.webhookSecret) return <WebhookReady agent={agent} automation={create.data} secret={create.data.webhookSecret} />
  return <Dialog className="dlg sheet" labelledBy="auto-h" onClosed={() => navigate(home)}>{(close) =>
    <form className="dlgform" onSubmit={(event) => {
      const value = formValues(event)
      const schedule = trigger === 'schedule' ? scheduleFrom({ every, value }) : undefined
      create.mutate({ agentId: agent.id, name: value('name'), instructions: value('instructions'), ...(schedule ? { schedule } : { webhook: true }), postTo: value('postTo') || null, enabled },
        { onSuccess: (automation) => { if (!automation.webhookSecret) close() } })
    }}>
      <DialogHead id="auto-h" title="New automation" onClose={close} />
      <div className="dlgbody">
        <input name="name" className="title-in" aria-label="Name" placeholder="Name it, like Morning pipeline digest" required maxLength={80} autoFocus />
        <div className="group">
          <span className="glabel">Trigger</span>
          <div className="trig" role="radiogroup" aria-label="Trigger">
            <TriggerCard id="schedule" current={trigger} onPick={setTrigger} title="Schedule" line="Runs at set times" />
            <TriggerCard id="webhook" current={trigger} onPick={setTrigger} title="Webhook" line="Runs when an app calls it" />
          </div>
          <div className="whenbox">
            <div className={trigger === 'schedule' ? 'when' : 'when off'}>
              <ScheduleFields every={every} onEvery={setEvery} />
            </div>
            <div className={trigger === 'webhook' ? 'when' : 'when off'}>
              <p className="hookpre">{AUTOMATION_ICONS.webhook}You get the URL and secret after you create it. The secret is shown once.</p>
              <span className="hint">Callers send <code>POST</code> with <code>Authorization: Bearer &lt;secret&gt;</code>. The body goes to {agent.name} with the instructions.</span>
            </div>
          </div>
        </div>
        <label className="group"><span className="glabel">Instructions</span>
          <textarea name="instructions" className="ta" required maxLength={5000} placeholder={`What should ${agent.name} do each time? Say when to stay quiet, like "If nothing changed, say nothing."`} />
        </label>
        <div className="group rowsplit">
          <div><span className="glabel">Post the result</span><span className="hint">Optional. Every run is kept either way.</span></div>
          <PostToPicker agent={agent} value={NOWHERE} />
        </div>
        <div className="group rowsplit">
          <div><span className="glabel">On</span><span className="hint">{enabled ? 'Starts running as soon as it\'s created.' : 'Stays paused until you turn it on.'}</span></div>
          <button type="button" className="sw" role="switch" aria-checked={enabled} aria-label="On" onClick={() => setEnabled(!enabled)}></button>
        </div>
      </div>
      <DialogFoot error={create.error?.message}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={create.isPending}>Create automation</button>
      </DialogFoot>
    </form>}
  </Dialog>
}

function TriggerCard({ id, current, onPick, title, line }: { id: 'schedule' | 'webhook'; current: string; onPick: (id: 'schedule' | 'webhook') => void; title: string; line: string }) {
  return <button type="button" className="tcard" role="radio" aria-checked={current === id} onClick={() => onPick(id)}>
    <span className="mark">{AUTOMATION_ICONS[id]}</span><span><b>{title}</b><span className="mute">{line}</span></span>
  </button>
}

function ScheduleFields({ every, onEvery, initial }: { every: Every; onEvery: (every: Every) => void; initial?: Schedule }) {
  const me = useMe()
  const zone = me.data?.timeZone ? ` (${me.data.timeZone})` : ''
  return <div className="chips" role="radiogroup" aria-label="How often">
    {EVERY.map((option) => <button key={option.id} type="button" className="chip" role="radio" aria-checked={every === option.id} onClick={() => onEvery(option.id)}>{option.label}</button>)}
    {every === 'weekly' && <select name="day" aria-label="Day" className="chipsel" defaultValue={initial?.day ?? 1}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>}
    {every === 'hourly'
      ? <select name="minute" aria-label="Minute past the hour" className="chipsel" defaultValue={initial?.at.slice(3) ?? '00'}>{MINUTES.map((minute) => <option key={minute} value={minute}>:{minute}</option>)}</select>
      : <input type="time" name="at" aria-label="Time" className="chipsel" defaultValue={initial?.at ?? '09:00'} required />}
    <span className="hint wide">{every === 'hourly' ? 'Runs every hour at that minute.' : `Server time${zone}.`}</span>
  </div>
}

function scheduleFrom({ every, value }: { every: Every; value: (name: string) => string }): Schedule {
  const at = every === 'hourly' ? `00:${value('minute') || '00'}` : value('at') || '09:00'
  return { every, at, ...(every === 'weekly' && { day: Number(value('day')) }) }
}

function PostToPicker({ agent, value }: { agent: Agent; value: string }) {
  const targets = useSendTargets({ agentId: agent.id, enabled: true })
  const known = targets.data ?? []
  const options: SendTarget[] = value && !known.some((target) => target.id === value) ? [...known, { id: value, object: 'send_target', platform: value.split(':')[0], name: value, type: '' }] : known
  return <select name="postTo" aria-label="Post the result to" className="postsel" defaultValue={value}>
    <option value={NOWHERE}>Don't post</option>
    {options.map((target) => <option key={target.id} value={target.id}>{label(target)}</option>)}
    {targets.isLoading && <option disabled>Looking for channels…</option>}
    {targets.data && !known.length && <option disabled>{agent.status === 'running' ? 'No channels yet: connect Slack, Telegram or WhatsApp' : `Start ${agent.name} to see its channels`}</option>}
  </select>
}

function WebhookReady({ agent, automation, secret }: { agent: Agent; automation: Automation; secret: string }) {
  const home = `/agents/${agent.id}`
  return <Dialog className="dlg sheet" labelledBy="hook-h" dismissable={false} onClosed={() => navigate(home)}>{(close) =>
    <div className="dlgform">
      <DialogHead id="hook-h" title={`${automation.name} is ready`} subtitle="Copy the secret now. It isn't shown again." onClose={close} />
      <div className="dlgbody">
        <div className="group"><span className="glabel">Webhook URL</span><div className="secretrow"><code>{automation.webhookUrl}</code><CopyButton text={automation.webhookUrl ?? ''} label="Copy" /></div></div>
        <div className="group"><span className="glabel">Secret</span><div className="secretrow"><code>{secret}</code><CopyButton text={secret} label="Copy" /></div></div>
        <span className="hint">Send <code>POST {automation.webhookUrl}</code> with the header <code>Authorization: Bearer {'<secret>'}</code> and any JSON body.</span>
      </div>
      <DialogFoot><button type="button" className="btn primary" onClick={close}>Done</button></DialogFoot>
    </div>}
  </Dialog>
}

function AutomationSheet({ agent, automation, lockReason, placeName }: { agent: Agent; automation: Automation; lockReason: string | undefined; placeName: (id: string) => string }) {
  const [editing, setEditing] = useState(false)
  const runs = useAutomationRuns(automation.id)
  const run = useRunAutomation({ agentId: agent.id, automationId: automation.id })
  const remove = useDeleteAutomation({ agentId: agent.id, automationId: automation.id })
  const update = useUpdateAutomation({ agentId: agent.id, automationId: automation.id })
  const [every, setEvery] = useState<Every>(automation.schedule?.every ?? 'daily')
  const busy = runs.data?.some((each) => each.status === 'running') || run.isPending
  const home = `/agents/${agent.id}`
  return <Dialog className="dlg sheet" labelledBy="autod-h" onClosed={() => navigate(home)}>{(close) => editing
    ? <form className="dlgform" onSubmit={(event) => {
      const value = formValues(event)
      const schedule = automation.schedule ? scheduleFrom({ every, value }) : undefined
      update.mutate({ name: value('name'), instructions: value('instructions'), postTo: value('postTo') || null, ...(schedule && { schedule }) }, { onSuccess: () => setEditing(false) })
    }}>
      <DialogHead id="autod-h" title={`Edit ${automation.name}`} onClose={close} />
      <div className="dlgbody">
        <input name="name" className="title-in" aria-label="Name" required maxLength={80} defaultValue={automation.name} />
        {automation.schedule && <div className="group"><span className="glabel">Schedule</span><ScheduleFields every={every} onEvery={setEvery} initial={automation.schedule} /></div>}
        <label className="group"><span className="glabel">Instructions</span><textarea name="instructions" className="ta" required maxLength={5000} defaultValue={automation.instructions} /></label>
        <div className="group rowsplit"><div><span className="glabel">Post the result</span><span className="hint">Optional. Every run is kept either way.</span></div><PostToPicker agent={agent} value={automation.postTo ?? NOWHERE} /></div>
      </div>
      <DialogFoot error={update.error?.message}>
        <button type="button" className="btn sec" onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn primary" disabled={update.isPending}>Save</button>
      </DialogFoot>
    </form>
    : <div className="dlgform">
      <DialogHead id="autod-h" title={automation.name} subtitle={`${triggerLine(automation)}${automation.postTo ? ` · posts to ${placeName(automation.postTo)}` : ''}`} onClose={close} />
      <div className="dlgbody">
        {automation.webhookUrl && <div className="group"><span className="glabel">Webhook URL</span><div className="secretrow"><code>{automation.webhookUrl}</code><CopyButton text={automation.webhookUrl} label="Copy" /></div></div>}
        <div className="group"><span className="glabel">Runs</span>
          <ErrorNote message={runs.error?.message} />
          {runs.data && !runs.data.length && <p className="note">No runs yet. {automation.trigger === 'schedule' && automation.nextRunAt ? `The first is ${when(automation.nextRunAt)}.` : ''}</p>}
          {!!runs.data?.length && <div className="box rows">{runs.data.map((each) => <RunRow key={each.id} run={each} />)}</div>}
        </div>
      </div>
      <DialogFoot error={run.error?.message} start={<Locked reason={lockReason}>
        <ConfirmButton className="btn danger" disabled={!agent.canEdit || remove.isPending} question={`Delete ${automation.name}?`} detail={automation.webhookUrl ? 'Its webhook URL stops working. This can\'t be undone.' : 'This can\'t be undone.'} action="Delete"
          onConfirm={() => remove.mutate(undefined, { onSuccess: close, onError: toastError })}>Delete</ConfirmButton>
      </Locked>}>
        <Locked reason={lockReason}><button type="button" className="btn sec" disabled={!agent.canEdit} onClick={() => setEditing(true)}>Edit</button></Locked>
        <Locked reason={lockReason}><button type="button" className="btn primary" disabled={!agent.canEdit || busy} onClick={() => run.mutate()}>{busy ? 'Running…' : 'Run now'}</button></Locked>
      </DialogFoot>
    </div>}
  </Dialog>
}

function RunRow({ run }: { run: AutomationRun }) {
  const [open, setOpen] = useState(false)
  const detail = run.error ?? run.answer
  return <div className="runrow-w">
    <button type="button" className="row runrow" aria-expanded={open} disabled={!detail} onClick={() => setOpen(!open)}>
      <RunIcon status={run.status} />
      <span className="rwhen">{when(run.startedAt)}</span>
      <span className="mute rwhat ellip">{summary(run)}</span>
      <span className="mute rdur">{run.ms === null ? '' : `${Math.round(run.ms / 1000)}s`}</span>
    </button>
    {open && run.error && <p className="runtext">{run.error}</p>}
    {open && !run.error && run.answer && <div className="runtext msg-t"><Markdown remarkPlugins={[remarkGfm]}>{run.answer}</Markdown></div>}
  </div>
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
  const platform = target.platform.charAt(0).toUpperCase() + target.platform.slice(1)
  return `${platform} · ${target.name}`
}

function when(iso: string): string {
  const date = new Date(iso)
  const far = Math.abs(Date.now() - date.getTime()) > WEEK_MS
  return date.toLocaleString('en', far ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function plain(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
}
