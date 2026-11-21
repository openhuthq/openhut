import { useEffect, useRef, useState } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { SquareLock02Icon, UserGroupIcon, AiBrain01Icon, ArrowRight01Icon, BookOpen01Icon, Delete02Icon, LaptopIcon, MoreHorizontalIcon, PlayIcon, SourceCodeIcon, StopIcon, PencilEdit02Icon, PlusSignIcon, ServerStack01Icon, SparklesIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog, useConfirming } from '@/components/confirm-button'
import { Choice, DialogCard, DRAG, GLASS, HOVER, I, MenuCard, PILL, ROW, ROW_VALUE, Section, TINY_ICON } from '@/components/kit'
import { agentPath, type AgentDialog } from '@/app/routes'
import { useAgents, useChannels, useDeleteAgent, useMemory, useSkills, useUpdateAgent } from '@/features/agents/api'
import type { Computer } from '@openhut/client'
import { nameOf, runsOnNote, useComputers, useFeatures } from '@/features/computers/api'
import { ChangedBy, useChangedByOther } from '@/features/cloud/live'
import { EditLock, FieldBox, useHolder } from '@/features/cloud/presence'
import { CanUse } from '@/features/agents/agent-connections'
import { BrowserPreview } from '@/features/agents/browser'
import { ChannelRows } from '@/features/agents/channels'
import { Face } from '@/features/agents/face'
import { useMove } from '@/features/agents/move'
import { RoutinesRow } from '@/features/routines/routines-dialog'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { ModelRows } from '@/features/agents/model-rows'
import { AgentStatus } from '@/features/agents/status'
import { HERE } from '@/features/settings/desktop'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { WORDS } from '@/lib/platform'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const VALUE = ROW_VALUE

export function Panel({ agent, naming, watching }: { agent: Agent; naming: boolean; watching: boolean }) {
  const memory = useMemoryCount(agent)
  const skills = useSkills(agent.id).data?.length
  return <aside className={cn('still flex w-[280px] shrink-0 flex-col gap-4 overflow-auto border-l-[0.5px] phone:w-full phone:flex-1 phone:border-l-0 border-hair px-4 pt-4 pb-4 [scrollbar-gutter:stable]', GLASS)}>
    <div className={cn('flex items-center gap-3', DRAG)}>
      <FieldBox agentId={agent.id} field="face" className="shrink-0">{agent.canEdit ? <a href={agentPath({ agentId: agent.id, dialog: 'customize' })} aria-label={`Customize ${agent.name}`} title="Customize" className="relative block shrink-0">
        <Face agent={agent} size={48} tile />
      </a> : <Face agent={agent} size={48} tile />}</FieldBox>
      <FieldBox agentId={agent.id} field="name" className="grid min-w-0 flex-1"><PanelTitle agent={agent} naming={naming} /></FieldBox>
    </div>
    <FieldBox agentId={agent.id} field="instructions" className="-mx-2.5"><Button type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'does' }))} className={cn('group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2', HOVER)}>
      <span className="flex items-center text-[12px]/[16px] text-mute">What it does<span className="ml-auto text-mute opacity-0 group-hover:opacity-100"><I icon={PencilEdit02Icon} size={13} /></span></span>
      <span className={cn('line-clamp-2 text-left text-[13px]/[1.45]', agent.summary ? 'text-ink' : 'text-body')}>{agent.summary || `Tell ${agent.name} what its job is.`}</span>
    </Button></FieldBox>
    <div className="-mx-2.5 flex flex-col gap-px">
      <ModelRows agent={agent} />
      <RunsOn agent={agent} />
      <Access agent={agent} />
      {agent.runsHere && <>
        <Counted agent={agent} dialog="memory" icon={AiBrain01Icon} title="Memory" value={memory} />
        <Counted agent={agent} dialog="skills" icon={BookOpen01Icon} title="Skills" value={skills} />
      </>}
      <RoutinesRow agent={agent} />
    </div>
    <BrowserRows agent={agent} watching={watching} />
    <ChannelRows agent={agent} />
    <CanUse agent={agent} />
    <AgentActions agent={agent} />
  </aside>
}

const LABEL = 'pb-1.5 text-[12px]/[16px] text-mute'

function BrowserRows({ agent, watching }: { agent: Agent; watching: boolean }) {
  const features = useFeatures(agent.id)
  const updateAgent = useUpdateAgent(agent.id)
  if (!features.browser && !agent.browser) return null
  const toggle = <span className="flex items-center gap-2">
    {agent.browser && agent.canEdit && <a className="text-[12px] text-body underline-offset-2 hover:underline" href={agentPath({ agentId: agent.id, dialog: 'browser' })}>Open</a>}
    <Switch checked={agent.browser} aria-label="Browser" disabled={!agent.canEdit || updateAgent.isPending} onCheckedChange={() => updateAgent.mutate({ browser: !agent.browser }, { onError: toastError })} />
  </span>
  return <Section title="Browser" action={toggle}>
    {agent.browser && agent.canEdit && !watching && <BrowserPreview agent={agent} />}
  </Section>
}

function AgentActions({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  const change = (patch: Parameters<typeof updateAgent.mutate>[0]) => updateAgent.mutate(patch, { onError: toastError })
  const locked = !agent.canEdit || !agent.canManage || updateAgent.isPending
  return <div className="mt-auto flex flex-col pt-2">
    <span className={LABEL}>Computer</span>
    <div className="-mx-2.5 flex flex-col gap-px">
      <label className={ROW}><I icon={SourceCodeIcon} size={15} className="text-mute" />Run code<Switch className="ml-auto" checked={agent.codeExecution} aria-label="Run code" disabled={locked} onCheckedChange={() => change({ codeExecution: !agent.codeExecution })} /></label>
    </div>
  </div>
}

function PanelTitle({ agent, naming }: { agent: Agent; naming: boolean }) {
  const updateAgent = useUpdateAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const { confirming, setConfirming, box } = useConfirming()
  const phone = useMedia(PHONE)
  const running = agent.wanted === 'running'
  const toggle = running ? `Stop ${agent.name}` : `Start ${agent.name}`
  return <div ref={box} className="grid min-w-0 flex-1 gap-0.5">
    <div className="flex min-w-0 items-center gap-1"><AgentName agent={agent} editing={naming && agent.canEdit} />
      {agent.canEdit && !naming && <a href={agentPath({ agentId: agent.id, dialog: 'customize' })} aria-label={`Customize ${agent.name}`} title="Customize" className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-hover hover:text-ink"><I icon={PencilEdit02Icon} size={14} /></a>}
      {phone ? <PhoneActions agent={agent} /> : <span className="ml-auto flex shrink-0 items-center gap-0.5">{confirming
        ? <>
          <Button type="button" variant="secondary" className={PILL} autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" variant="destructive" className={cn(PILL, 'ml-1')} disabled={deleteAgent.isPending} onClick={() => deleteAgent.mutate(undefined, { onError: toastError })}>Delete</Button>
        </>
        : <>
          <Tooltip label={toggle}><Button type="button" variant="bare" className={TINY_ICON} aria-label={toggle} disabled={!agent.canEdit || updateAgent.isPending}
            onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} className={running ? 'text-hue-amber' : 'text-hue-green'} /></Button></Tooltip>
          {agent.canEdit && agent.canManage && <Tooltip label={`Delete ${agent.name}`}><Button type="button" variant="bare" className={cn(TINY_ICON, 'text-fail')} aria-label={`Delete ${agent.name}`} onClick={() => setConfirming(true)}><I icon={Delete02Icon} size={16} /></Button></Tooltip>}
        </>}</span>}
    </div>
    <span className="flex items-center gap-2 text-xs text-body">{confirming ? 'Its memory goes too.' : <AgentStatus agent={agent} />}</span>
  </div>
}


function PhoneActions({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const [deleting, setDeleting] = useState(false)
  const running = agent.wanted === 'running'
  return <span className="ml-auto flex shrink-0 items-center gap-1">
    {agent.canEdit && <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="bare" className={cn(TINY_ICON, 'size-9 rounded-full')} aria-label={`More for ${agent.name}`} />}><I icon={MoreHorizontalIcon} size={20} /></DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'customize' }))}><I icon={PencilEdit02Icon} size={16} />Customize</DropdownMenuItem>
        <DropdownMenuItem disabled={updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} />{running ? `Stop ${agent.name}` : `Start ${agent.name}`}</DropdownMenuItem>
        {agent.canManage && <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}><I icon={Delete02Icon} size={16} />Delete {agent.name}…</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>}
    <DialogClose render={<Button type="button" variant="bare" className="h-9 rounded-full px-3 text-[16px] font-semibold text-ink" />}>Done</DialogClose>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} question={`Delete ${agent.name}?`} detail="Its chats, memory and skills go with it." action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })} />
  </span>
}

function useMemoryCount(agent: Agent) {
  const memory = useMemory(agent.id).data
  if (!memory) return undefined
  const count = memory.notes.entries.length + memory.people.entries.length
  return count === 1 ? '1 note' : `${count} notes`
}

function Counted({ agent, dialog, icon, title, value }: { agent: Agent; dialog: AgentDialog; icon: IconSvgElement; title: string; value: string | number | undefined }) {
  return <a className={ROW} href={agentPath({ agentId: agent.id, dialog })}><I icon={icon} size={15} className="text-mute" />{title}<span className={VALUE}>{value ?? ''}<I icon={ArrowRight01Icon} size={12} className="text-mute" /></span></a>
}

function RunsOn({ agent }: { agent: Agent }) {
  const computers = useComputers().data
  const home = useAgents().data?.find((each) => each.id === agent.id)
  const id = home?.computer ?? 'local'
  const live = home?.online ?? true
  const move = useMove(home)
  const update = useUpdateAgent(agent.id)
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger className={ROW} disabled={!!move.going}><I icon={LaptopIcon} size={15} className="text-mute" />Runs on<span className={VALUE}>{move.going ? <><Spinner className="mt-0" /><span className="truncate">Moving to {move.going}…</span></> : <>{!live && <i className="size-1.5 rounded-full bg-mute-2" />}<span className="truncate">{agent.runsHere ? nameOf({ computers, id }) : elsewhereOf(agent)}{!live && ' · Offline'}</span></>}<I icon={UnfoldMoreIcon} size={12} className="text-mute" /></span></DropdownMenuTrigger>
      <MenuCard title={`${agent.name} runs on`}>
        {!agent.runsHere && <Choice icon={<I icon={LaptopIcon} size={15} />} name={elsewhereOf(agent)} selected disabled />}
        {(computers ?? []).map((computer) => !agent.runsHere && computer.id === id
          ? <Choice key={computer.id} icon={<I icon={LaptopIcon} size={15} />} name="Run it here" disabled={!agent.canEdit || update.isPending} onClick={() => update.mutate({ runsHere: true }, { onError: toastError })} />
          : <Choice key={computer.id} icon={<I icon={computer.id === 'local' ? LaptopIcon : ServerStack01Icon} size={15} />} name={computer.id === id ? computer.name : `Move to ${computer.name}`}
          note={runsOnNote(computer)}
          selected={computer.id === id} disabled={computer.id === id || !computer.online || !agent.canEdit || !agent.canManage} onClick={() => move.go(computer.id)} />)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8 gap-2 text-[13px]" onClick={() => navigate('/settings/devices')}><I icon={PlusSignIcon} size={14} className="text-pass" />Add a computer…</DropdownMenuItem>
      </MenuCard>
    </DropdownMenu>
    {move.line
      ? <p role="status" className="m-0 px-2.5 py-1 text-[12.5px]/[1.45] text-body">{move.line}</p>
      : <p className="m-0 px-2.5 pb-1 text-[12px]/[1.45] text-mute">{noteOf({ agent, computers, id })}</p>}
    {id === 'local' && !WORDS.sandboxed && <TeamHint agent={agent} server={(computers ?? []).find((each) => each.id !== 'local' && each.online)} onMove={(to) => move.go(to)} />}
  </>
}

function Access({ agent }: { agent: Agent }) {
  const { all, email } = useWorkspaces()
  const home = useAgents().data?.find((each) => each.id === agent.id)
  const update = useUpdateAgent(agent.id)
  const workspace = all.find((each) => agent.workspace ? each.id === agent.workspace : each.home)
  if (!workspace || (home?.computer ?? 'local') !== 'local') return null
  const mine = !agent.owner || agent.owner === email
  const pick = (shared: boolean) => update.mutate({ shared }, { onError: toastError })
  return <DropdownMenu>
      <DropdownMenuTrigger className={ROW} disabled={update.isPending}><I icon={agent.shared ? UserGroupIcon : SquareLock02Icon} size={15} className="text-mute" />Access<span className={VALUE}>{agent.shared ? 'Shared' : 'Private'}<I icon={UnfoldMoreIcon} size={12} className="text-mute" /></span></DropdownMenuTrigger>
      <MenuCard title={`Who can use ${agent.name}`}>
        <Choice icon={<I icon={SquareLock02Icon} size={15} />} name="Private" note="Only you" selected={!agent.shared} disabled={!agent.shared || !mine} onClick={() => pick(false)} />
        <Choice icon={<I icon={UserGroupIcon} size={15} />} name="Shared" note={`Everyone in ${workspace.name} can use and edit it`} selected={agent.shared} disabled={agent.shared || !agent.canManage} onClick={() => pick(true)} />
      </MenuCard>
    </DropdownMenu>
}

function noteOf({ agent, computers, id }: { agent: Agent; computers: Computer[] | undefined; id: string }): string {
  if (agent.runsNowhere) return 'No computer runs it now. Run it here to start it.'
  if (!agent.runsHere) return 'Runs on your other computer. Chats sync here.'
  if (id !== 'local') return `Runs in its own sandbox on ${nameOf({ computers, id })}.`
  if (WORDS.sandboxed) return `Runs in its own sandbox on this ${HERE}.`
  return `Runs as you, like any app on this ${HERE}.`
}

function elsewhereOf(agent: Agent): string {
  return agent.runsNowhere ? 'No computer' : 'Another computer'
}

function TeamHint({ agent, server, onMove }: { agent: Agent; server: { id: string; name: string } | undefined; onMove: (to: string) => void }) {
  const slack = useChannels(agent.id).data?.some((channel) => channel.kind === 'slack' && channel.status === 'connected')
  if (!slack) return null
  return <div className="mx-2.5 mt-1 mb-1 flex flex-col items-start gap-1 rounded-lg bg-tint px-3 py-2.5 text-[12.5px]/[1.45] text-body">
    <span>{agent.name} is in your team's Slack. For team use, run it on a server.</span>
    {server
      ? <Button type="button" variant="text" onClick={() => onMove(server.id)}>Move to {server.name}</Button>
      : <Button type="button" variant="text" onClick={() => navigate('/settings/devices')}>Add a computer</Button>}
  </div>
}

const NAME = 'm-0 min-w-0 text-[18px]/[1.3] font-semibold'

function AgentName({ agent, editing }: { agent: Agent; editing: boolean }) {
  const updateAgent = useUpdateAgent(agent.id)
  const ref = useRef<HTMLHeadingElement>(null)
  const home = agentPath({ agentId: agent.id })
  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.focus()
    getSelection()?.selectAllChildren(ref.current)
  }, [editing])
  if (!editing) return <h2 className={cn(NAME, 'truncate')} title={agent.canEdit ? 'Double-click to rename' : undefined} onDoubleClick={agent.canEdit ? () => navigate(agentPath({ agentId: agent.id, dialog: 'name' }), true) : undefined}>{updateAgent.isPending ? updateAgent.variables.name ?? agent.name : agent.name}</h2>
  return <h2 ref={ref} className={cn(NAME, 'min-w-[1ch] cursor-text overflow-hidden whitespace-nowrap shadow-[0_2px_0_var(--ink)] outline-none')} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label="Agent name" spellCheck={false}
    onKeyDown={(event) => {
      if (event.key === 'Escape') event.currentTarget.textContent = agent.name
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur() }
    }}
    onBlur={(event) => {
      const name = (event.currentTarget.textContent ?? '').trim()
      const heading = event.currentTarget
      if (name && name !== agent.name) updateAgent.mutate({ name }, { onError: (error) => { heading.textContent = agent.name; toastError(error) } })
      else heading.textContent = agent.name
      navigate(home, true)
    }}>{agent.name}</h2>
}

export function DoesDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const changedByOther = useChangedByOther(agent.changedBy)
  const { locked } = useHolder({ agentId: agent.id, field: 'instructions' })
  const [draft, setDraft] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (locked && box.current) box.current.value = agent.instructions
  }, [locked, agent.instructions])
  return <DialogCard onClose={onClose} className="w-[560px]">
    <form className="contents" onSubmit={(event) => updateAgent.mutate({ instructions: formValues(event)('instructions') }, { onSuccess: onClose })}>
      <div className="flex items-center gap-3"><Face agent={agent} size={40} /><DialogTitle className="text-[18px] font-semibold">What {agent.name} does</DialogTitle></div>
      <Textarea ref={box} autoFocus name="instructions" aria-label="Instructions" maxLength={20000} readOnly={!agent.canEdit || locked} defaultValue={agent.instructions} rows={9} placeholder={`What does ${agent.name} do? Who does it answer, and what must it never do?`}
        onInput={(event) => setDraft(event.currentTarget.value === agent.instructions ? null : event.currentTarget.value)}
        className={cn('min-h-[220px] rounded-lg font-sans text-[14px]/[1.55]', locked && 'bg-soft text-body')} />
      {updateAgent.error && <p role="alert" className="m-0 text-xs text-fail">{updateAgent.error.message}</p>}
      {locked ? <EditLock agentId={agent.id} field="instructions" draft={draft} onClose={onClose} /> : <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-mute"><I icon={SparklesIcon} size={13} />{agent.changedBy && changedByOther ? <ChangedBy email={agent.changedBy} /> : `Plain words are fine. ${agent.name} reads this before every reply.`}</span>
        <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!agent.canEdit || updateAgent.isPending}>Save</Button></span>
      </div>}
    </form>
  </DialogCard>
}
