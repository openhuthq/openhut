import { useEffect, useRef } from 'react'
import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { Avatar } from '@/components/avatar'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { FACT_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { OwnerChip } from '@/components/owner-chip'
import { Page } from '@/components/page'
import { AgentBadge } from '@/components/status-badge'
import { AgentConnections } from '@/features/agents/agent-connections'
import { useAgent, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { ChannelsSection } from '@/features/agents/channels-section'
import { InstructionsSection } from '@/features/agents/instructions-section'
import { ModelPicker, SizePicker } from '@/features/agents/model-picker'
import { SkillsSection } from '@/features/agents/skills-section'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

export type AgentDialog = 'name' | 'instructions' | 'slack' | 'whatsapp' | 'telegram'

const PARENTS = [{ label: 'Agents', href: '/agents' }]

export function AgentPage({ agentId, dialog, skill }: { agentId: string; dialog: AgentDialog | undefined; skill: string | undefined }) {
  const agent = useAgent(agentId)
  if (!agent.data) return <Page title="Agent" parents={PARENTS}><ErrorNote message={agent.error?.message} /></Page>
  return <AgentView agent={agent.data} dialog={dialog} skill={skill} />
}

function AgentView({ agent, dialog, skill }: { agent: Agent; dialog: AgentDialog | undefined; skill: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const lockReason = agent.canEdit ? undefined : `Only ${agent.ownerName} or an admin can change ${agent.name}`
  const running = agent.status === 'running'
  const actions = <>
    <a className="btn sec" href={`/agents/${agent.id}/chat`}>{ICONS.chat}<span className="lbl">Chat</span></a>
    <Locked reason={lockReason}>
      <button className="btn sec" disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}>
        {running ? ICONS.stop : ICONS.play}<span className="lbl">{running ? 'Stop' : 'Start'}</span>
      </button>
    </Locked>
    <span className="vsep"></span>
    <Locked reason={lockReason}>
      <ConfirmButton className="btn danger" disabled={!agent.canEdit} question={`Delete ${agent.name}?`} detail="This can't be undone." action="Delete" onConfirm={() => deleteAgent.mutate(undefined, { onError: toastError })}>
        {ICONS.trash}<span className="lbl">Delete</span>
      </ConfirmButton>
    </Locked>
  </>
  return <Page title={agent.name} parents={PARENTS} actions={actions}>
    <div className="detail wide">
      <div className="left">
        <div className="hero">
          <Avatar id={agent.id} about={agent.instructions} size={64} />
          <AgentName agent={agent} editing={dialog === 'name' && agent.canEdit} />
        </div>
        <InstructionsSection agent={agent} editing={dialog === 'instructions'} lockReason={lockReason} />
      </div>
      <aside className="rail">
        <div className="box facts">
          <div><span>{FACT_ICONS.status}Status</span><AgentBadge agent={agent} /></div>
          <div><span>{FACT_ICONS.model}Model</span><ModelPicker agent={agent} lockReason={lockReason} /></div>
          <div><span>{FACT_ICONS.computer}Computer</span><SizePicker agent={agent} lockReason={lockReason} /></div>
          <div><span>{FACT_ICONS.owner}Owner</span><OwnerChip id={agent.ownerId} name={agent.ownerName} /></div>
          <div><span>{FACT_ICONS.code}Code execution</span><CodeSwitch agent={agent} lockReason={lockReason} /></div>
        </div>
        <ChannelsSection agent={agent} lockReason={lockReason} dialog={dialog} />
        <AgentConnections agent={agent} lockReason={lockReason} />
        <SkillsSection agent={agent} lockReason={lockReason} open={skill} />
      </aside>
    </div>
  </Page>
}

function CodeSwitch({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Locked reason={lockReason}>
    <button className="sw" role="switch" aria-checked={agent.codeExecution} aria-label="Code execution" disabled={!agent.canEdit || updateAgent.isPending}
      onClick={() => updateAgent.mutate({ codeExecution: !agent.codeExecution }, { onError: toastError })}></button>
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
    return <div className="anamebox">
      <h2 className="aname ellip" title={agent.canEdit ? 'Double-click to rename' : undefined} onDoubleClick={agent.canEdit ? edit : undefined}>{updateAgent.isPending ? updateAgent.variables.name ?? agent.name : agent.name}</h2>
      {agent.canEdit && <button type="button" className="rename" aria-label={`Rename ${agent.name}`} title="Rename" onClick={edit}>{ICONS.pencil}</button>}
    </div>
  }
  return <div className="anamebox">
    <h2 ref={ref} className="aname editing" contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label="Agent name" spellCheck={false}
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
