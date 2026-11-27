import { useEffect, useRef } from 'react'
import { ArrowRight01Icon, Globe02Icon, PlayIcon, Settings02Icon, SparklesIcon, StopIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { Glyph } from '@/components/glyph'
import { DialogCard, GLASS, HOVER, I, TINY_ICON } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useChannels, useGrants, useUpdateAgent } from '@/features/agents/api'
import { listedChannels } from '@/features/agents/channel-kinds'
import { useConnections } from '@/features/connections/api'
import { connectionBrand } from '@/features/connections/catalog'
import { Face } from '@/features/agents/face'
import { PanelThreads } from '@/features/threads/thread-list'
import { useGitHubFace } from '@/features/agents/github-face'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function Panel({ agent, threadId, naming, collapsed = false, onBrowser }: { agent: Agent; threadId: string | undefined; naming: boolean; collapsed?: boolean; onBrowser?: () => void }) {
  useGitHubFace(agent)
  return <aside data-details inert={collapsed} className={cn('still flex shrink-0 justify-end overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring) phone:w-full phone:flex-1 phone:border-l-0', collapsed ? 'w-0' : 'w-[340px] border-l-[0.5px]', GLASS)}>
    <div className={cn('flex w-[340px] shrink-0 flex-col gap-7 p-6 transition-[opacity,translate] duration-[160ms] ease-out phone:w-full', collapsed && 'translate-x-2 opacity-0')}>
      <div className="grid shrink-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3">
        {agent.canEdit ? <a href={agentPath({ agentId: agent.id, dialog: 'customize' })} aria-label={`Customize ${agent.name}`} title="Customize" className="flex"><Face agent={agent} size={40} /></a> : <Face agent={agent} size={40} />}
        <div className="grid min-w-0"><AgentName agent={agent} editing={naming && agent.canEdit} /></div>
        <HeadActions agent={agent} onBrowser={onBrowser} />
        <Connected agent={agent} />
      </div>
      <PanelThreads agent={agent} threadId={threadId} />
    </div>
  </aside>
}

function HeadActions({ agent, onBrowser }: { agent: Agent; onBrowser?: () => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const phone = useMedia(PHONE)
  const running = agent.wanted === 'running'
  const toggle = running ? `Stop ${agent.name}` : `Start ${agent.name}`
  return <span className="flex items-center gap-2">
    {onBrowser && <Tooltip label="Open the browser"><Button type="button" variant="bare" className={cn(TINY_ICON, 'relative text-body')} aria-label="Open the browser" onClick={onBrowser}>
      <I icon={Globe02Icon} size={16} /><i aria-label="Live" className="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-pass shadow-[0_0_0_2px_var(--sidebar)]" />
    </Button></Tooltip>}
    <Tooltip label="Setup"><a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className={TINY_ICON}><I icon={Settings02Icon} size={16} /></a></Tooltip>
    <Tooltip label={toggle}><Button type="button" variant="bare" className={TINY_ICON} aria-label={toggle} disabled={!agent.canEdit || updateAgent.isPending}
      onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} className={running ? 'text-hue-amber' : 'text-hue-green'} /></Button></Tooltip>
    {phone && <DialogClose render={<Button type="button" variant="bare" className="h-9 rounded-full px-3 text-[16px] font-semibold text-ink" />}>Done</DialogClose>}
  </span>
}

function Connected({ agent }: { agent: Agent }) {
  const channels = listedChannels(useChannels(agent.id).data ?? []).map((channel) => channel.kind)
  const connections = useConnections().data ?? []
  const apps = (useGrants({ agentId: agent.id }).data ?? []).flatMap((grant) => {
    const connection = connections.find((each) => each.id === grant.connectionId)
    return connection ? [connectionBrand(connection)] : []
  })
  const marks = [...new Set([...channels, ...apps])]
  const shown = marks.slice(0, 4)
  const more = marks.length - shown.length
  return <a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'connections' })} aria-label={`What ${agent.name} is connected to. Opens setup`}
    className={cn('col-span-full -mx-2 flex h-9 items-center gap-2.5 rounded-lg px-2 text-left text-ink no-underline', HOVER)}>
    {shown.length ? <span className="flex items-center gap-2.5">{shown.map((kind) => <Glyph key={kind} name={kind} size={16} />)}{more > 0 && <span className="text-[12.5px] text-mute">+{more}</span>}</span>
      : <span className="text-[12.5px] text-mute">No apps or channels yet</span>}
    <span className="ml-auto inline-flex items-center gap-0.5 text-[12.5px] text-mute">Setup<I icon={ArrowRight01Icon} size={12} /></span>
  </a>
}

const NAME = 'm-0 min-w-0 text-[17px]/[22px] font-semibold'

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
