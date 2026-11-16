import { useEffect, useRef } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Creature } from '@/components/creature'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Fact, Facts } from '@/components/facts'
import { FACT_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { OwnerChip } from '@/components/owner-chip'
import { ButtonLabel, Page } from '@/components/page'
import { AgentBadge } from '@/components/status-badge'
import { AgentConnections } from '@/features/agents/agent-connections'
import { useAgent, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { ChannelsSection } from '@/features/agents/channels-section'
import { InstructionsSection } from '@/features/agents/instructions-section'
import { ModelPicker, SizePicker } from '@/features/agents/model-picker'
import { MemoryRow, MemorySheet } from '@/features/agents/memory-section'
import { SkillsSection } from '@/features/agents/skills-section'
import { AutomationsSection } from '@/features/automations/automations-section'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export type AgentDialog = 'name' | 'instructions' | 'slack' | 'whatsapp' | 'telegram' | 'memory'

const PARENTS = [{ label: 'Agents', href: '/agents' }]
const NAME_BOX = 'group/name flex min-w-0 items-center gap-1.5'
const NAME = 'm-0 min-w-0 text-[18px] font-medium selection:bg-[oklch(0%_0_0/.14)]'

export function AgentPage({ agentId, dialog, skill, automation }: { agentId: string; dialog: AgentDialog | undefined; skill: string | undefined; automation?: string }) {
  const agent = useAgent(agentId)
  if (!agent.data) return <Page title="Agent" parents={PARENTS}><ErrorNote message={agent.error?.message} /></Page>
  return <AgentView agent={agent.data} dialog={dialog} skill={skill} automation={automation} />
}

function AgentView({ agent, dialog, skill, automation }: { agent: Agent; dialog: AgentDialog | undefined; skill: string | undefined; automation: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const lockReason = agent.canEdit ? undefined : `Only ${agent.ownerName} or an admin can change ${agent.name}`
  const running = agent.status === 'running'
  const actions = <>
    <a className={buttonVariants({ variant: 'secondary' })} href={`/agents/${agent.id}/chat`}>{ICONS.chat}<ButtonLabel>Chat</ButtonLabel></a>
    <Locked reason={lockReason}>
      <Button type="button" variant="secondary" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}>
        {running ? ICONS.stop : ICONS.play}<ButtonLabel>{running ? 'Stop' : 'Start'}</ButtonLabel>
      </Button>
    </Locked>
    <Separator orientation="vertical" />
    <Locked reason={lockReason}>
      <ConfirmButton disabled={!agent.canEdit} question={`Delete ${agent.name}?`} detail="This can't be undone." action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })}>
        {ICONS.trash}<ButtonLabel>Delete</ButtonLabel>
      </ConfirmButton>
    </Locked>
  </>
  return <Page title={agent.name} parents={PARENTS} actions={actions} hero>
    <div className="mx-auto flex max-w-[1152px] flex-col gap-8">
      <div className="-mb-[22px] flex items-center gap-3">
        <Creature id={agent.id} about={agent.instructions} size={64} />
        <AgentName agent={agent} editing={dialog === 'name' && agent.canEdit} />
      </div>
      <div className="mx-auto grid w-full max-w-[1152px] grid-cols-[minmax(0,1fr)_380px] gap-6 mobile:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-6">
          <InstructionsSection agent={agent} editing={dialog === 'instructions'} lockReason={lockReason} />
          <AutomationsSection agent={agent} lockReason={lockReason} open={automation} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6 mobile:-order-1">
          <Facts>
            <Fact icon={FACT_ICONS.status} label="Status"><AgentBadge agent={agent} /></Fact>
            <Fact icon={FACT_ICONS.model} label="Model"><ModelPicker agent={agent} lockReason={lockReason} /></Fact>
            <Fact icon={FACT_ICONS.computer} label="Computer"><SizePicker agent={agent} lockReason={lockReason} /></Fact>
            <Fact icon={FACT_ICONS.owner} label="Owner"><OwnerChip id={agent.ownerId} name={agent.ownerName} /></Fact>
            <Fact icon={FACT_ICONS.code} label="Code execution"><CodeSwitch agent={agent} lockReason={lockReason} /></Fact>
            <MemoryRow agent={agent} />
          </Facts>
          <ChannelsSection agent={agent} lockReason={lockReason} dialog={dialog} />
          <AgentConnections agent={agent} lockReason={lockReason} />
        </aside>
      </div>
      <SkillsSection agent={agent} lockReason={lockReason} open={skill} />
      {dialog === 'memory' && <MemorySheet agent={agent} lockReason={lockReason} />}
    </div>
  </Page>
}

function CodeSwitch({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Locked reason={lockReason}>
    <Switch checked={agent.codeExecution} aria-label="Code execution" disabled={!agent.canEdit || updateAgent.isPending}
      onCheckedChange={() => updateAgent.mutate({ codeExecution: !agent.codeExecution }, { onError: toastError })} />
  </Locked>
}

function AgentName({ agent, editing }: { agent: Agent; editing: boolean }) {
  const updateAgent = useUpdateAgent(agent.id)
  const ref = useRef<HTMLHeadingElement>(null)
  const home = `/agents/${agent.id}`
  const edit = () => navigate(`${home}/name`, true)
  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.focus()
    getSelection()?.selectAllChildren(ref.current)
  }, [editing])
  if (!editing) {
    return <div className={NAME_BOX}>
      <h2 className={cn(NAME, 'truncate')} title={agent.canEdit ? 'Double-click to rename' : undefined} onDoubleClick={agent.canEdit ? edit : undefined}>{updateAgent.isPending ? updateAgent.variables.name ?? agent.name : agent.name}</h2>
      {agent.canEdit && <Button type="button" size="icon-xs" className="opacity-0 [transition:opacity_.15s] group-hover/name:opacity-100 focus-visible:opacity-100" aria-label={`Rename ${agent.name}`} title="Rename" onClick={edit}>{ICONS.pencil}</Button>}
    </div>
  }
  return <div className={NAME_BOX}>
    <h2 ref={ref} className={cn(NAME, 'min-w-[1ch] cursor-text overflow-hidden rounded-none whitespace-nowrap shadow-[0_2px_0_var(--ink)] outline-none')} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label="Agent name" spellCheck={false}
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
  </div>
}
