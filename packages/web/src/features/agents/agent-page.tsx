import type { Agent } from '@jakebox/common/agents/agent.ts'
import { Avatar } from '@/components/avatar'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { FACT_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { OwnerChip } from '@/components/owner-chip'
import { Page } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { AgentConnections } from '@/features/agents/agent-connections'
import { useAgent, useDeleteAgent, useUpdateAgent } from '@/features/agents/api'
import { ChannelsSection } from '@/features/agents/channels-section'
import { InstructionsSection } from '@/features/agents/instructions-section'
import { ModelPicker } from '@/features/agents/model-picker'
import { toastError } from '@/lib/toast'

export type AgentDialog = 'instructions' | 'slack' | 'whatsapp'

const PARENTS = [{ label: 'Agents', href: '/agents' }]

export function AgentPage({ agentId, dialog }: { agentId: string; dialog: AgentDialog | undefined }) {
  const agent = useAgent(agentId)
  if (!agent.data) return <Page title="Agent" parents={PARENTS}><ErrorNote message={agent.error?.message} /></Page>
  return <AgentView agent={agent.data} dialog={dialog} />
}

function AgentView({ agent, dialog }: { agent: Agent; dialog: AgentDialog | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)
  const lockReason = agent.canEdit ? undefined : `Only ${agent.ownerName} or an admin can change ${agent.name}`
  const running = agent.status === 'running'
  const actions = <>
    <Locked reason={lockReason}>
      <button className={running ? 'btn stop' : 'btn go'} disabled={!agent.canEdit || updateAgent.isPending} onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}>
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
          <h2 className="aname ellip">{agent.name}</h2>
        </div>
        <InstructionsSection agent={agent} editing={dialog === 'instructions'} lockReason={lockReason} />
      </div>
      <aside className="rail">
        <div className="box facts">
          <div><span>{FACT_ICONS.status}Status</span><StatusBadge status={agent.status} /></div>
          <div><span>{FACT_ICONS.model}Model</span><ModelPicker agent={agent} lockReason={lockReason} /></div>
          <div><span>{FACT_ICONS.owner}Owner</span><OwnerChip id={agent.ownerId} name={agent.ownerName} /></div>
        </div>
        <ChannelsSection agent={agent} lockReason={lockReason} dialog={dialog} />
        <AgentConnections agent={agent} lockReason={lockReason} />
      </aside>
    </div>
  </Page>
}
