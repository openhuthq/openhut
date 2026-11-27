import { FlashIcon, Globe02Icon, Link01Icon, Message01Icon, PencilEdit02Icon, PlayIcon, Settings02Icon, StopIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { DialogCard, GLASS, HOVER, I, TINY_ICON } from '@/components/kit'
import { Glyph } from '@/components/glyph'
import { agentPath } from '@/app/routes'
import { useChannels, useGrants, useUpdateAgent } from '@/features/agents/api'
import { listedChannels } from '@/features/agents/channel-kinds'
import { useConnections } from '@/features/connections/api'
import { connectionBrand } from '@/features/connections/catalog'
import { useRoutines } from '@/features/routines/api'
import { Face } from '@/features/agents/face'
import { PanelThreads } from '@/features/threads/thread-list'
import { RetryApply } from '@/features/agents/status'
import { useGitHubFace } from '@/features/agents/github-face'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function Panel({ agent, threadId, collapsed = false }: { agent: Agent; threadId: string | undefined; collapsed?: boolean }) {
  useGitHubFace(agent)
  const phone = useMedia(PHONE)
  return <aside data-details inert={collapsed} className={cn('still flex shrink-0 justify-end overflow-hidden border-hair transition-[width] duration-[240ms] ease-(--ease-spring) phone:w-full phone:flex-1 phone:border-l-0', collapsed ? 'w-0' : 'w-[340px] border-l-[0.5px]', GLASS)}>
    <div className={cn('flex w-[340px] shrink-0 flex-col gap-7 p-6 transition-[opacity,translate] duration-[160ms] ease-out phone:w-full', collapsed && 'translate-x-2 opacity-0')}>
      {phone && <DialogClose render={<Button type="button" variant="bare" className="h-9 self-end rounded-full px-3 text-[16px] font-semibold text-ink" />}>Done</DialogClose>}
      <div className="flex shrink-0 flex-col gap-3">
        {agent.applyError && <RetryApply agent={agent} />}
        <WhatItDoes agent={agent} />
        <Capabilities agent={agent} />
      </div>
      <PanelThreads agent={agent} threadId={threadId} />
    </div>
  </aside>
}

export function AgentActions({ agent, onBrowser }: { agent: Agent; onBrowser?: () => void }) {
  const updateAgent = useUpdateAgent(agent.id)
  const running = agent.wanted === 'running'
  const toggle = running ? 'Stop' : 'Start'
  return <>
    {onBrowser && <Tooltip label="Browser"><Button type="button" variant="bare" className={cn(TINY_ICON, 'relative text-body')} aria-label="Browser" onClick={onBrowser}>
      <I icon={Globe02Icon} size={16} /><i aria-label="Live" className="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-pass shadow-[0_0_0_2px_var(--card)]" />
    </Button></Tooltip>}
    <Tooltip label="Setup"><a href={agentPath({ agentId: agent.id, dialog: 'setup', detail: 'general' })} aria-label={`Set up ${agent.name}`} className={TINY_ICON}><I icon={Settings02Icon} size={16} /></a></Tooltip>
    <Tooltip label={toggle}><Button type="button" variant="bare" className={TINY_ICON} aria-label={`${toggle} ${agent.name}`} disabled={!agent.canEdit || updateAgent.isPending}
      onClick={() => updateAgent.mutate({ wanted: running ? 'stopped' : 'running' }, { onError: toastError })}><I icon={running ? StopIcon : PlayIcon} size={16} className={running ? 'text-hue-amber' : 'text-hue-green'} /></Button></Tooltip>
  </>
}

function WhatItDoes({ agent }: { agent: Agent }) {
  return <div className="relative -mx-2.5"><Button type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'does' }))} className={cn('group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2', HOVER)}>
    <span className="flex items-center text-[12px]/[16px] text-mute">What it does<span className="ml-auto text-mute opacity-0 group-hover:opacity-100"><I icon={PencilEdit02Icon} size={13} /></span></span>
    <span className={cn('line-clamp-2 text-left text-[13px]/[1.45]', agent.summary ? 'text-ink' : 'text-body')}>{agent.summary || 'Tell it what its job is.'}</span>
  </Button></div>
}

const CHANNEL_WORD: Record<string, string> = { slack: 'Slack', discord: 'Discord', whatsapp: 'WhatsApp', telegram: 'Telegram' }

function Capabilities({ agent }: { agent: Agent }) {
  const connections = useConnections().data ?? []
  const apps = (useGrants({ agentId: agent.id }).data ?? []).flatMap((grant) => connections.filter((each) => each.id === grant.connectionId))
  const channels = listedChannels(useChannels(agent.id).data ?? []).filter((channel) => channel.status === 'connected')
  const routines = (useRoutines(agent.id).data ?? []).filter((routine) => !routine.stopped).length
  const can = [agent.browser && 'Browse', agent.codeExecution && 'Run code', routines > 0 && (routines === 1 ? '1 routine' : `${routines} routines`)].filter((each) => typeof each === 'string')
  const lines = [
    apps.length > 0 && { label: 'Apps', icon: Link01Icon, tab: 'connections', marks: apps.map(connectionBrand), words: apps.map((each) => each.name) },
    channels.length > 0 && { label: 'Channels', icon: Message01Icon, tab: 'channels', marks: channels.map((each) => each.kind), words: channels.map((each) => CHANNEL_WORD[each.kind] ?? each.kind) },
    can.length > 0 && { label: 'Can', icon: FlashIcon, tab: 'general', marks: [], words: can, joiner: ' · ' },
  ].filter((each) => !!each)
  if (!lines.length) return null
  return <div className="-my-1 flex flex-col">
    {lines.map(({ label, icon, tab, marks, words, joiner }) => <a key={label} href={agentPath({ agentId: agent.id, dialog: 'setup', detail: tab })}
      className={cn('-mx-2 grid grid-cols-[88px_minmax(0,1fr)] items-center rounded-md px-2 py-1 text-[13px]/[20px] text-ink no-underline', HOVER)}>
      <span className="flex items-center gap-1.5 text-mute"><I icon={icon} size={16} />{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {marks.length > 0 && <span className="flex shrink-0 items-center">{marks.slice(0, 3).map((mark, index) => <span key={index} className="grid size-[22px] place-items-center rounded-full bg-card shadow-[0_0_0_1.5px_var(--sidebar)] [&+&]:-ml-1.5"><Glyph name={mark} size={16} /></span>)}</span>}
        <span className="min-w-0 truncate">{joiner ? words.join(joiner) : namesOf(words)}</span>
      </span>
    </a>)}
  </div>
}

function namesOf(words: string[]) {
  return words.length > 3 ? `${words.slice(0, 3).join(', ')} +${words.length - 3}` : words.join(', ')
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
