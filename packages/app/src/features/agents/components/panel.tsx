import type { ReactNode } from 'react'
import { Settings02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { DialogCard, I, TINY_ICON } from '@/components/kit'
import { agentPath } from '@/config/paths'
import { useUpdateAgent } from '@/lib/queries/agents'
import { Face } from '@/components/agent-face'
import { useGitHubFace } from '@/features/agents/github-face'
import { formValues } from '@/lib/form'

export function SyncFace({ agent }: { agent: Agent }) {
  useGitHubFace(agent)
  return null
}

export function AgentActions({ agent, threads }: { agent: Agent; threads?: ReactNode }) {
  return <>
    {threads}
    <Tooltip label="Setup"><a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className={TINY_ICON}><I icon={Settings02Icon} size={16} /></a></Tooltip>
  </>
}

export function DoesDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <DialogCard onClose={onClose} className="w-[560px]">
    <form className="contents" onSubmit={(event) => updateAgent.mutate({ instructions: formValues(event)('instructions') }, { onSuccess: onClose })}>
      <div className="flex items-center gap-3"><Face agent={agent} size={40} /><DialogTitle className="text-[18px] font-semibold">What it does</DialogTitle></div>
      <Textarea autoFocus name="instructions" aria-label="Instructions" maxLength={20000} readOnly={!agent.canEdit} defaultValue={agent.instructions} rows={9} placeholder={`What does ${agent.name} do? Who does it answer, and what must it never do?`}
        className="min-h-[220px] rounded-lg font-sans text-[14px]/[1.55]" />
      {updateAgent.error && <p role="alert" className="m-0 text-xs text-fail">{updateAgent.error.message}</p>}
      <div className="flex items-center gap-2">
        <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!agent.canEdit || updateAgent.isPending}>Save</Button></span>
      </div>
    </form>
  </DialogCard>
}
