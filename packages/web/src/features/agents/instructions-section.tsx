import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { CardButton } from '@/components/ui/card'
import { Dialog, DialogFoot, DialogFrame, DialogHead } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { useUpdateAgent } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

export function InstructionsSection({ agent, editing, lockReason }: { agent: Agent; editing: boolean; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const preview = agent.instructions.split('\n').slice(0, 16).join('\n')
  const close = () => navigate(`/agents/${agent.id}`)
  return <section className="flex flex-1 flex-col">
    <SectionHead title="Instructions" />
    <CardButton type="button" variant="preview" className="after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[76px] after:bg-[linear-gradient(to_bottom,transparent,var(--card)_62%)]" onClick={() => navigate(`/agents/${agent.id}/instructions`)} aria-haspopup="dialog" aria-label={`Edit ${agent.name}'s instructions`}>
      <pre className="absolute inset-x-4 top-4 bottom-14 m-0 overflow-hidden font-mono text-[12px]/[1.7] font-normal [overflow-wrap:anywhere] whitespace-pre-wrap text-ink">{preview || <span className="text-mute">No instructions yet. What does {agent.name} do, who does it answer, and what must it never do?</span>}</pre>
      <span className="absolute right-3 bottom-3 z-1 inline-flex items-center gap-1.5 rounded-lg bg-canvas px-2.5 py-[5px] text-sm font-medium text-body">{ICONS.expand}Open to edit</span>
    </CardButton>
    {editing && <Dialog onClose={close}>
      <DialogFrame onSubmit={(event) => updateAgent.mutate({ instructions: formValues(event)('instructions') }, { onSuccess: close })}>
        <DialogHead title={`${agent.name}'s instructions`} subtitle={`Saving restarts ${agent.name} if it's running.`} onClose={close} />
        <Textarea variant="editor" name="instructions" aria-label="Instructions" maxLength={20000} readOnly={!agent.canEdit} defaultValue={agent.instructions} placeholder={`What does ${agent.name} do? Who does it answer, and what must it never do?`} />
        <DialogFoot error={updateAgent.error?.message}>
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Locked reason={lockReason}><Button type="submit" variant="primary" disabled={!agent.canEdit || updateAgent.isPending}>Save</Button></Locked>
        </DialogFoot>
      </DialogFrame>
    </Dialog>}
  </section>
}
