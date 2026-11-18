import { useEffect, useRef } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { AiBrain01Icon, ArrowRight01Icon, BookOpen01Icon, Delete02Icon, LaptopIcon, PlayIcon, SourceCodeIcon, StopIcon, PencilEdit02Icon, PlusSignIcon, ServerStack01Icon, SparklesIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton, useConfirming } from '@/components/confirm-button'
import { Choice, DialogCard, DRAG, GLASS, HOVER, I, MenuCard, PILL, ROW, ROW_VALUE, Section, TINY_ICON } from '@/components/kit'
import { agentPath, type AgentDialog } from '@/app/routes'
import { useAgents, useDeleteAgent, useMemory, useSkills, useUpdateAgent } from '@/features/agents/api'
import { nameOf, useComputers, useFeatures } from '@/features/computers/api'
import { CanUse } from '@/features/agents/agent-connections'
import { BrowserPreview } from '@/features/agents/browser'
import { ChannelRows } from '@/features/agents/channels'
import { Face } from '@/features/agents/face'
import { useMove } from '@/features/agents/move'
import { ModelRows } from '@/features/agents/model-rows'
import { AgentStatus } from '@/features/agents/status'
import { HERE } from '@/features/settings/desktop'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const VALUE = ROW_VALUE

export function Panel({ agent, naming, watching }: { agent: Agent; naming: boolean; watching: boolean }) {
  return <aside className={cn('still flex w-[280px] shrink-0 flex-col gap-4 overflow-auto border-l-[0.5px] phone:w-full phone:flex-1 phone:border-l-0 border-hair px-4 pt-4 pb-4 [scrollbar-gutter:stable]', GLASS)}>
    <div className={cn('flex items-center gap-3', DRAG)}>
      <Face agent={agent} size={48} tile />
      <PanelTitle agent={agent} naming={naming} />
    </div>
    <Button type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'does' }))} className={cn('group -mx-2.5 flex flex-col gap-1 rounded-lg px-2.5 py-2', HOVER)}>
      <span className="flex items-center text-[12px]/[16px] text-mute">What it does<span className="ml-auto text-mute opacity-0 group-hover:opacity-100"><I icon={PencilEdit02Icon} size={13} /></span></span>
      <span className={cn('line-clamp-2 text-[13px]/[1.45]', agent.summary ? 'text-ink' : 'text-body')}>{agent.summary || `Tell ${agent.name} what its job is.`}</span>
    </Button>
    <div className="-mx-2.5 flex flex-col gap-px">
      <ModelRows agent={agent} />
      <RunsOn agent={agent} />
      <Counted agent={agent} dialog="memory" icon={AiBrain01Icon} title="Memory" value={useMemoryCount(agent)} />
      <Counted agent={agent} dialog="skills" icon={BookOpen01Icon} title="Skills" value={useSkills(agent.id).data?.length} />
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
  const locked = !agent.canEdit || updateAgent.isPending
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
      <span className="ml-auto flex shrink-0 items-center gap-0.5">{confirming
        ? <>
          <Button type="button" variant="secondary" className={PILL} autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
          <Button type="button" variant="destructive" className={cn(PILL, 'ml-1')} disabled={deleteAgent.isPending} onClick={() => deleteAgent.mutate(undefined, { onError: toastError })}>Delete</Button>
        </>
        : <>
          <Tooltip label={toggle}><Button type="button" variant="bare" className={TINY_ICON} aria-label={toggle} disabled={!agent.canEdit || updateAgent.isPending}
            onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} className={running ? 'text-hue-amber' : 'text-hue-green'} /></Button></Tooltip>
          {agent.canEdit && phone && <ConfirmButton variant="bare" className={cn(TINY_ICON, 'text-fail')} label={`Delete ${agent.name}`} question={`Delete ${agent.name}?`} detail="" action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })}><I icon={Delete02Icon} size={16} /></ConfirmButton>}
          {agent.canEdit && !phone && <Tooltip label={`Delete ${agent.name}`}><Button type="button" variant="bare" className={cn(TINY_ICON, 'text-fail')} aria-label={`Delete ${agent.name}`} onClick={() => setConfirming(true)}><I icon={Delete02Icon} size={16} /></Button></Tooltip>}
        </>}</span>
    </div>
    <span className="flex items-center gap-2 text-xs text-body">{confirming ? 'Its memory goes too.' : <AgentStatus agent={agent} />}</span>
  </div>
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
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger className={ROW} disabled={!!move.going}><I icon={LaptopIcon} size={15} className="text-mute" />Runs on<span className={VALUE}>{move.going ? <><Spinner className="mt-0" /><span className="truncate">Moving to {move.going}…</span></> : <>{!live && <i className="size-1.5 rounded-full bg-mute-2" />}<span className="truncate">{nameOf({ computers, id })}{!live && ' · Offline'}</span></>}<I icon={UnfoldMoreIcon} size={12} className="text-mute" /></span></DropdownMenuTrigger>
      <MenuCard title={`${agent.name} runs on`}>
        {(computers ?? []).map((computer) => <Choice key={computer.id} icon={<I icon={computer.id === 'local' ? LaptopIcon : ServerStack01Icon} size={15} />} name={computer.id === id ? computer.name : `Move to ${computer.name}`}
          note={computer.online ? computer.id === 'local' ? `Only while this ${HERE} is awake` : 'Always on' : 'Offline'}
          selected={computer.id === id} disabled={computer.id === id || !computer.online || !agent.canEdit} onClick={() => move.go(computer.id)} />)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8 gap-2 text-[13px]" onClick={() => navigate('/settings/devices')}><I icon={PlusSignIcon} size={14} className="text-pass" />Add a computer…</DropdownMenuItem>
      </MenuCard>
    </DropdownMenu>
    {move.line && <p role="status" className="m-0 px-2.5 py-1 text-[12.5px]/[1.45] text-body">{move.line}</p>}
  </>
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
