import type { Agent } from '@jakebox/common/agents/agent.ts'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { useUpdateAgent } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

export function InstructionsSection({ agent, editing, lockReason }: { agent: Agent; editing: boolean; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const preview = agent.instructions.split('\n').slice(0, 16).join('\n')
  return <section>
    <SectionHead title="Instructions" />
    <button type="button" className="soul" onClick={() => navigate(`/agents/${agent.id}/instructions`)} aria-haspopup="dialog" aria-label={`Edit ${agent.name}'s instructions`}>
      <pre>{preview || <span className="mute">No instructions yet. What does {agent.name} do, who does it answer, and what must it never do?</span>}</pre>
      <span className="soulfoot">{ICONS.expand}Open to edit</span>
    </button>
    {editing && <Dialog labelledBy="soul-h" onClosed={() => navigate(`/agents/${agent.id}`)}>{(close) =>
      <form className="dlgform" onSubmit={(event) => updateAgent.mutate({ instructions: formValues(event)('instructions') }, { onSuccess: close })}>
        <DialogHead id="soul-h" title={`${agent.name}'s instructions`} subtitle={`Saving restarts ${agent.name} if it's running.`} onClose={close} />
        <textarea name="instructions" aria-label="Instructions" maxLength={20000} readOnly={!agent.canEdit} defaultValue={agent.instructions} placeholder={`What does ${agent.name} do? Who does it answer, and what must it never do?`} />
        <DialogFoot error={updateAgent.error?.message}>
          <button type="button" className="btn sec" onClick={close}>Cancel</button>
          <Locked reason={lockReason}><button className="btn primary" disabled={!agent.canEdit || updateAgent.isPending}>Save</button></Locked>
        </DialogFoot>
      </form>}
    </Dialog>}
  </section>
}
