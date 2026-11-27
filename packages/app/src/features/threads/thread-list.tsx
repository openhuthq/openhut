import type { MouseEvent, ReactElement } from 'react'
import { ArchiveIcon, ArrowRight01Icon, Clock01Icon, GlobalIcon, WebhookIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Glyph } from '@/components/glyph'
import { ErrorNote } from '@/components/error-note'
import { HOVER, I, PICKED, Section } from '@/components/kit'
import { agentPath, threadRoute } from '@/app/routes'
import { useArchiveThread, useThreads } from '@/features/threads/api'
import { PREVIEW_THREADS, sourceOf, startedIn, threadsOf, type SourcedThread } from '@/features/threads/places'
import { ago } from '@/lib/format'
import { navigate } from '@/lib/router'
import { usePresence } from '@/lib/thread-live'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export type ThreadStatus = 'main' | 'working' | 'waiting' | 'idle'

const MARK: Record<ThreadStatus, ReactElement> = {
  main: <><circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink)" strokeWidth="1.6" /><circle cx="8" cy="8" r="3" fill="var(--ink)" /></>,
  working: <><circle cx="8" cy="8" r="5.8" fill="none" stroke="var(--mid)" strokeWidth="1.6" /><path d="M8 2.2a5.8 5.8 0 0 1 5.8 5.8" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" /></>,
  waiting: <circle cx="8" cy="8" r="4" fill="#D9824A" />,
  idle: <circle cx="8" cy="8" r="5.8" fill="none" stroke="var(--mute-2)" strokeWidth="1.6" strokeDasharray="2.4 2.15" />,
}

const MARK_LABEL: Record<ThreadStatus, string> = { main: 'Main thread', working: 'Working', waiting: 'Waiting on you', idle: 'Idle' }

export function ThreadMark({ status }: { status: ThreadStatus }) {
  return <svg role="img" aria-label={MARK_LABEL[status]} width="16" height="16" viewBox="0 0 16 16" className={cn('block shrink-0', status === 'working' && 'animate-spin motion-reduce:animate-none')}>{MARK[status]}</svg>
}

const SOURCE_ICON = { app: GlobalIcon, webhook: WebhookIcon, routine: Clock01Icon }

export function ThreadRow({ agentId, thread, active }: { agentId: string; thread: SourcedThread; active: boolean }) {
  const source = sourceOf(thread)
  const busy = usePresence(thread.id).agent.state !== 'idle'
  const archive = useArchiveThread(thread)
  const main = thread.id === agentId
  const where = startedIn(thread)
  const title = main ? 'Main thread' : thread.title
  const status: ThreadStatus = thread.waiting ? 'waiting' : busy ? 'working' : main ? 'main' : 'idle'
  const onArchive = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    archive.mutate(undefined, { onSuccess: () => active && navigate(agentPath({ agentId })), onError: toastError })
  }
  return <div className="group/thread relative">
    <a href={threadRoute({ agentId, threadId: thread.id })} aria-current={active ? 'page' : undefined} className={cn('flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink no-underline', HOVER, active && PICKED)}>
      <ThreadMark status={status} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className={cn('flex shrink-0 items-center gap-1.5 text-[12px] text-mute tabular-nums', !main && 'group-hover/thread:invisible group-focus-within/thread:invisible')}>
        <span role="img" aria-label={where} title={where} className="grid place-items-center">{source.platform === 'discord' ? <Glyph name="discord" size={13} /> : <I icon={SOURCE_ICON[source.platform]} size={13} />}</span>
        <span className="min-w-6 text-right">{ago(thread.updatedAt)}</span>
      </span>
    </a>
    {!main && <Button type="button" variant="bare" aria-label={`Archive ${thread.title}`} title="Archive" disabled={archive.isPending} onClick={onArchive}
      className={cn('absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-mute opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100', HOVER)}>
      <I icon={ArchiveIcon} size={14} />
    </Button>}
  </div>
}

export function ThreadsSection({ agent, threadId }: { agent: Agent; threadId: string | undefined }) {
  const threads = useThreads()
  const mine = threadsOf(threads.data ?? [], agent.id)
  const open = threadId ?? agent.id
  return <Section title="Threads">
    <ErrorNote message={threads.error?.message} />
    <div className="-mx-2.5 flex flex-col gap-px">
      {mine.slice(0, PREVIEW_THREADS).map((thread) => <ThreadRow key={thread.id} agentId={agent.id} thread={thread} active={thread.id === open} />)}
      {mine.length > PREVIEW_THREADS && <a href={agentPath({ agentId: agent.id, dialog: 'threads' })} className={cn('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-body no-underline', HOVER)}>
        Show all {mine.length}<I icon={ArrowRight01Icon} size={12} className="text-mute" />
      </a>}
    </div>
  </Section>
}
