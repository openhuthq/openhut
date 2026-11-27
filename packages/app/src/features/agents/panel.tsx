import { useEffect, type ReactNode } from 'react'
import { FlashIcon, Globe02Icon, Link01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, Settings02Icon, StopIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { DialogCard, HOVER, I, TINY_ICON } from '@/components/kit'
import { Glyph } from '@/components/glyph'
import { agentPath } from '@/app/routes'
import { useChannels, useGrants, useUpdateAgent } from '@/features/agents/api'
import { listedChannels } from '@/features/agents/channel-kinds'
import { useConnections } from '@/features/connections/api'
import { connectionBrand } from '@/features/connections/catalog'
import { useRoutines } from '@/features/routines/api'
import { Face } from '@/features/agents/face'
import { PanelThreads } from '@/features/threads/thread-list'
import { useGitHubFace } from '@/features/agents/github-face'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function FloatingThreads({ agent, threadId, onClose }: { agent: Agent; threadId: string | undefined; onClose: () => void }) {
  useEffect(() => {
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role=dialog]')) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return <section aria-label="Threads" className="absolute top-[56px] right-3 z-20 flex h-[min(520px,calc(100%-196px))] w-[360px] flex-col rounded-2xl border border-hair bg-card p-4 pb-3 shadow-pop">
    <PanelThreads agent={agent} threadId={threadId} onClose={onClose} />
  </section>
}

export function AgentActions({ agent, threads }: { agent: Agent; threads?: ReactNode }) {
  const updateAgent = useUpdateAgent(agent.id)
  const running = agent.wanted === 'running'
  const toggle = running ? 'Stop' : 'Start'
  return <>
    {threads}
    <Tooltip label="Setup"><a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className={TINY_ICON}><I icon={Settings02Icon} size={16} /></a></Tooltip>
    <Tooltip label={toggle}><Button type="button" variant="bare" className={TINY_ICON} aria-label={`${toggle} ${agent.name}`} disabled={!agent.canEdit || updateAgent.isPending}
      onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} className={running ? 'text-hue-red' : 'text-hue-green'} /></Button></Tooltip>
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
