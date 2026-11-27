import { useEffect, type MouseEvent, type ReactElement } from 'react'
import { ArchiveIcon, Cancel01Icon, GlobalIcon, HistoryIcon, PlusSignIcon, WebhookIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { ErrorNote } from '@/components/error-note'
import { HOVER, I, PICKED } from '@/components/kit'
import { agentPath, threadRoute } from '@/config/paths'
import { useArchiveThread, useCreateThread, useThreads } from '@/features/threads/api'
import { sourceOf, startedIn, threadsOf, type SourcedThread } from '@/lib/places'
import { ago } from '@/lib/format'
import { navigate } from '@/lib/router'
import { useWorking } from '@/lib/thread-live'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useMoreBelow } from '@/lib/more-below'

export type ThreadStatus = 'main' | 'working' | 'waiting' | 'idle'

const MARK: Record<ThreadStatus, ReactElement> = {
  main: <><circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink)" strokeWidth="1.6" /><circle cx="8" cy="8" r="3" fill="var(--ink)" /></>,
  working: <><circle cx="8" cy="8" r="5.8" fill="none" stroke="var(--mid)" strokeWidth="1.6" /><path d="M8 2.2a5.8 5.8 0 0 1 5.8 5.8" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" /></>,
  waiting: <circle cx="8" cy="8" r="4" fill="var(--wait)" />,
  idle: <circle cx="8" cy="8" r="5.8" fill="none" stroke="var(--mute-2)" strokeWidth="1.6" strokeDasharray="2.4 2.15" />,
}

const MARK_LABEL: Record<ThreadStatus, string> = { main: 'Main thread', working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }

export function ThreadMark({ status, size = 16 }: { status: ThreadStatus; size?: number }) {
  return <svg role="img" aria-label={MARK_LABEL[status]} width={size} height={size} viewBox="0 0 16 16" className={cn('block shrink-0', status === 'working' && 'animate-spin motion-reduce:animate-none')}>{MARK[status]}</svg>
}

const SOURCE_ICON = { app: GlobalIcon, webhook: WebhookIcon, routine: HistoryIcon }

export function ThreadRow({ agentId, thread, active }: { agentId: string; thread: SourcedThread; active: boolean }) {
  const archive = useArchiveThread(thread)
  const main = thread.id === agentId
  const where = startedIn(thread)
  const title = titleOf({ agentId, thread })
  const status = useThreadStatus({ agentId, thread })
  const onArchive = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    archive.mutate(undefined, { onSuccess: () => active && navigate(agentPath({ agentId })), onError: toastError })
  }
  return <div className="group/thread relative">
    <a href={threadRoute({ agentId, threadId: thread.id })} aria-current={active ? 'page' : undefined} className={cn('flex h-[38px] items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink no-underline', HOVER, active && PICKED)}>
      <ThreadMark status={status} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className={cn('flex shrink-0 items-center gap-1.5 text-[12px] text-mute tabular-nums', !main && 'group-hover/thread:invisible group-focus-within/thread:invisible')}>
        <SourceIcon thread={thread} size={13} label={where} />
        <span className="min-w-6 text-right">{ago(thread.updatedAt)}</span>
      </span>
    </a>
    {!main && <Button type="button" variant="bare" aria-label={`Archive ${thread.title}`} title="Archive" disabled={archive.isPending} onClick={onArchive}
      className={cn('absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-mute opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100', HOVER)}>
      <I icon={ArchiveIcon} size={14} />
    </Button>}
  </div>
}

export function titleOf({ agentId, thread }: { agentId: string; thread: SourcedThread }): string {
  return thread.id === agentId ? 'Main thread' : thread.title
}

export function useThreadStatus({ agentId, thread }: { agentId: string; thread: SourcedThread }): ThreadStatus {
  const working = useWorking(thread.id)
  if (thread.waiting) return 'waiting'
  if (working) return 'working'
  return thread.id === agentId ? 'main' : 'idle'
}

export function SourceIcon({ thread, size, label }: { thread: SourcedThread; size: number; label: string }) {
  const { platform } = sourceOf(thread)
  return <span role="img" aria-label={label} title={label} className="grid place-items-center text-mute">{platform === 'discord' ? <Glyph name="discord" size={size} /> : <I icon={SOURCE_ICON[platform]} size={size} />}</span>
}

export function PanelThreads({ agent, threadId, onClose }: { agent: Agent; threadId: string | undefined; onClose?: () => void }) {
  const threads = useThreads()
  const create = useCreateThread(agent.id)
  const mine = threadsOf({ threads: threads.data ?? [], agent })
  const open = threadId ?? agent.id
  const list = useMoreBelow<HTMLDivElement>()
  return <div className="flex min-h-0 flex-1 flex-col gap-2.5">
    <div className="flex items-center text-[12px]/[16px] text-mute">Threads<span className="ml-auto flex items-center gap-3.5">
      <Button type="button" variant="bare" className="inline-flex h-auto items-center gap-1 p-0 text-[12px] font-medium text-ink hover:underline" disabled={create.isPending || !agent.canEdit} onClick={() => create.mutate(undefined, { onError: toastError })}><I icon={PlusSignIcon} size={12} />New</Button>
      <a href={agentPath({ agentId: agent.id, dialog: 'threads' })} className="text-[12px] font-medium text-ink no-underline hover:underline">View all</a>
      {onClose && <Button type="button" variant="bare" aria-label="Close" title="Close" onClick={onClose} className={cn('-my-1 -mr-1.5 grid size-6 place-items-center rounded-md text-mute hover:text-ink', HOVER)}><I icon={Cancel01Icon} size={14} /></Button>}
    </span></div>
    <ErrorNote message={threads.error?.message} />
    <div ref={list.ref} className={cn('no-scrollbar -mx-2.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto', list.more && '[mask-image:linear-gradient(to_bottom,#000_calc(100%-56px),transparent)]')}>
      {mine.map((thread) => <ThreadRow key={thread.id} agentId={agent.id} thread={thread} active={thread.id === open} />)}
    </div>
  </div>
}

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
