import { useEffect, useRef, useState } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { BrowserIcon, SidebarRight01Icon, AiBrain01Icon, ArrowRight01Icon, BookOpen01Icon, Delete02Icon, MoreHorizontalIcon, PlayIcon, SourceCodeIcon, StopIcon, PencilEdit02Icon, SparklesIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog, useConfirming } from '@/components/confirm-button'
import { DialogCard, GLASS, HOVER, I, ICON_BUTTON, PILL, ROW, ROW_VALUE, TINY_ICON } from '@/components/kit'
import { agentPath, type AgentDialog } from '@/app/routes'
import { useDeleteAgent, useMemory, useSkills, useUpdateAgent } from '@/features/agents/api'
import { useFeatures } from '@/features/computers/api'
import { CanUse } from '@/features/agents/agent-connections'
import { BrowserPreview } from '@/features/agents/browser'
import { ChannelRows } from '@/features/agents/channels'
import { Face } from '@/features/agents/face'
import { RoutinesRow } from '@/features/routines/routines-dialog'
import { ModelRows } from '@/features/agents/model-rows'
import { RunsOnRow } from '@/features/agents/move'
import { AgentStatus } from '@/features/agents/status'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const VALUE = ROW_VALUE

export function Panel({ agent, naming, watching, onHide }: { agent: Agent; naming: boolean; watching: boolean; onHide: () => void }) {
  const memory = useMemoryCount(agent)
  const skills = skillsNote(useSkills(agent.id).data)
  return <aside className={cn('still flex w-[280px] shrink-0 flex-col gap-4 overflow-auto border-l-[0.5px] phone:w-full phone:flex-1 phone:border-l-0 border-hair px-4 pt-4 pb-4 [scrollbar-gutter:stable]', GLASS)}>
    <div className={'flex items-center gap-3'}>
      <div className="relative shrink-0">{agent.canEdit ? <a href={agentPath({ agentId: agent.id, dialog: 'customize' })} aria-label={`Customize ${agent.name}`} title="Customize" className="relative block shrink-0">
        <Face agent={agent} size={48} tile />
      </a> : <Face agent={agent} size={48} tile />}</div>
      <div className="relative grid min-w-0 flex-1"><PanelTitle agent={agent} naming={naming} /></div>
      <Button type="button" variant="bare" className={cn(ICON_BUTTON, 'self-start phone:hidden')} aria-label="Hide details" title="Hide details" onClick={onHide}><I icon={SidebarRight01Icon} size={16} /></Button>
    </div>
    <div className="relative -mx-2.5"><Button type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'does' }))} className={cn('group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2', HOVER)}>
      <span className="flex items-center text-[12px]/[16px] text-mute">What it does<span className="ml-auto text-mute opacity-0 group-hover:opacity-100"><I icon={PencilEdit02Icon} size={13} /></span></span>
      <span className={cn('line-clamp-2 text-left text-[13px]/[1.45]', agent.summary ? 'text-ink' : 'text-body')}>{agent.summary || `Tell ${agent.name} what its job is.`}</span>
    </Button></div>
    <div className="-mx-2.5 flex flex-col gap-px">
      <ModelRows agent={agent} />
      <RunsOnRow agent={agent} />
      <SharedRow agent={agent} />
      {agent.runsHere && <>
        <Counted agent={agent} dialog="memory" icon={AiBrain01Icon} title="Memory" value={memory} />
        <Counted agent={agent} dialog="skills" icon={BookOpen01Icon} title="Skills" value={skills} />
      </>}
      <RoutinesRow agent={agent} />
    </div>
    <ChannelRows agent={agent} />
    <CanUse agent={agent} />
    <AgentActions agent={agent} watching={watching} />
  </aside>
}

const LABEL = 'pb-1.5 text-[12px]/[16px] text-mute'

// Only the owner shares: everyone on the team can then open and chat with it.
function SharedRow({ agent }: { agent: Agent }) {
  const updateAgent = useUpdateAgent(agent.id)
  if (!agent.canManage) return null
  return <label className={ROW}><I icon={UserMultipleIcon} size={15} className="text-mute" />Shared with team<Switch className="ml-auto" checked={agent.shared} aria-label="Shared with team" disabled={updateAgent.isPending}
    onCheckedChange={(on) => updateAgent.mutate({ shared: on }, { onError: toastError })} /></label>
}

function AgentActions({ agent, watching }: { agent: Agent; watching: boolean }) {
  const features = useFeatures(agent.runsOn ?? undefined)
  const updateAgent = useUpdateAgent(agent.id)
  const change = (patch: Parameters<typeof updateAgent.mutate>[0]) => updateAgent.mutate(patch, { onError: toastError })
  const locked = !agent.canEdit || !agent.canManage || updateAgent.isPending
  const browser = features.browser || agent.browser
  if (!agent.canManage && !browser && !agent.runsHere) return null
  return <div className="mt-auto flex flex-col pt-2">
    <span className={LABEL}>Allowed to</span>
    <div className="-mx-2.5 flex flex-col gap-px">
      {agent.canManage && <label className={ROW}><I icon={SourceCodeIcon} size={15} className="text-mute" />Run code<Switch className="ml-auto" checked={agent.codeExecution} aria-label="Run code" disabled={locked} onCheckedChange={() => change({ codeExecution: !agent.codeExecution })} /></label>}
      {(browser || agent.runsHere) && <label className={ROW}><I icon={BrowserIcon} size={15} className="text-mute" />Browser<span className="ml-auto flex items-center gap-2">
        {agent.browser && agent.canEdit && <a className="text-[12px] text-body underline-offset-2 hover:underline" href={agentPath({ agentId: agent.id, dialog: 'browser' })}>Open</a>}
        <Switch checked={agent.browser} aria-label="Browser" disabled={!browser || !agent.canEdit || updateAgent.isPending} onCheckedChange={() => change({ browser: !agent.browser })} />
      </span></label>}
      {!browser && agent.runsHere && <span className="px-2.5 pb-1 text-[12px]/[16px] text-mute">This computer can’t give agents a browser.</span>}
    </div>
    {agent.browser && agent.canEdit && !watching && <BrowserPreview agent={agent} />}
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
    <span className="flex items-center gap-2 text-xs text-body">{confirming ? 'Its chats, memory and skills go with it.' : <AgentStatus agent={agent} />}</span>
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
  return count === 1 ? '1 memory' : `${count} memories`
}

function skillsNote(skills: { builtIn: boolean }[] | undefined): string | undefined {
  if (!skills?.length) return undefined
  const learned = skills.filter((skill) => !skill.builtIn).length
  const builtIn = skills.length - learned
  return [learned && `${learned} learned`, builtIn && `${builtIn} built in`].filter(Boolean).join(' · ') || '0'
}

function Counted({ agent, dialog, icon, title, value }: { agent: Agent; dialog: AgentDialog; icon: IconSvgElement; title: string; value: string | number | undefined }) {
  return <a className={ROW} href={agentPath({ agentId: agent.id, dialog })}><I icon={icon} size={15} className="text-mute" />{title}<span className={VALUE}>{value ?? ''}<I icon={ArrowRight01Icon} size={12} className="text-mute" /></span></a>
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
  return <DialogCard onClose={onClose} className="w-[560px]">
    <form className="contents" onSubmit={(event) => updateAgent.mutate({ instructions: formValues(event)('instructions') }, { onSuccess: onClose })}>
      <div className="flex items-center gap-3"><Face agent={agent} size={40} /><DialogTitle className="text-[18px] font-semibold">What {agent.name} does</DialogTitle></div>
      <Textarea autoFocus name="instructions" aria-label="Instructions" maxLength={20000} readOnly={!agent.canEdit} defaultValue={agent.instructions} rows={9} placeholder={`What does ${agent.name} do? Who does it answer, and what must it never do?`}
        className="min-h-[220px] rounded-lg font-sans text-[14px]/[1.55]" />
      {updateAgent.error && <p role="alert" className="m-0 text-xs text-fail">{updateAgent.error.message}</p>}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-mute"><I icon={SparklesIcon} size={13} />Plain words are fine. {agent.name} reads this before every reply.</span>
        <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!agent.canEdit || updateAgent.isPending}>Save</Button></span>
      </div>
    </form>
  </DialogCard>
}
