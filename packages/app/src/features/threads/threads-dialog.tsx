import { useState } from 'react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, HOVER, I, Loading } from '@/components/kit'
import { threadRoute } from '@/app/routes'
import { Face } from '@/features/agents/face'
import { ThreadRow } from '@/features/agents/sidebar'
import { useThreads } from '@/features/threads/api'
import { sourceOf, type Origin, type SourcedThread } from '@/features/threads/places'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'

type Filter = 'all' | Origin['platform']

const FILTERS: [Filter, string][] = [['all', 'All'], ['app', 'Web'], ['discord', 'Discord'], ['webhook', 'Webhook'], ['routine', 'Routine']]

export function ThreadsDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const threads = useThreads()
  const [filter, setFilter] = useState<Filter>('all')
  const mine = (threads.data ?? []).filter((thread) => thread.agentId === agent.id)
  const shown = mine.filter((thread) => filter === 'all' || sourceOf(thread).platform === filter)
  const main = shown.find((thread) => thread.id === agent.id)
  const rest = shown.filter((thread) => thread !== main)
  return <DialogCard onClose={onClose} className="h-[min(680px,calc(100vh-48px))] w-[560px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-4">
      <Face agent={agent} size={28} />
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">{agent.name}'s threads</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="px-6 pb-3">
      <ToggleGroup aria-label="Where threads started" value={filter} onPick={(value) => setFilter(FILTERS.find(([id]) => id === value)?.[0] ?? filter)}>
        {FILTERS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
    <div className="fade-b no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-4 pb-4">
      <ErrorNote message={threads.error?.message} />
      {!threads.data && !threads.error && <Loading />}
      {main && <MainRow agent={agent} thread={main} />}
      {rest.map((thread) => <ThreadRow key={thread.id} agentId={agent.id} thread={thread} active={false} />)}
      {threads.data && !shown.length && <p className="m-0 px-2 py-6 text-center text-[13px] text-mute">No threads here yet.</p>}
    </div>
  </DialogCard>
}

function MainRow({ agent, thread }: { agent: Agent; thread: SourcedThread }) {
  return <a href={threadRoute({ agentId: agent.id, threadId: thread.id })} className={cn('mb-1.5 grid shrink-0 grid-cols-[32px_1fr] items-center gap-x-3 rounded-lg border border-hair px-3 py-2.5 text-inherit no-underline', HOVER)}>
    <Face agent={agent} size={32} />
    <span className="grid min-w-0">
      <span className="truncate text-[14px]/[20px] font-medium text-ink">Chat</span>
      <span className="truncate text-[12px]/[16px] text-mute-2 tabular-nums">Main thread · {ago(thread.updatedAt)}{thread.waiting && <span className="text-ink"> · Waiting on you</span>}</span>
    </span>
  </a>
}
