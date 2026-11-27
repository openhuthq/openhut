import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, Loading } from '@/components/kit'
import { Face } from '@/features/agents/face'
import { useThreads } from '@/features/threads/api'
import { threadsOf } from '@/features/threads/places'
import { ThreadRow } from '@/features/threads/thread-list'

export function ThreadsDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const threads = useThreads()
  const mine = threadsOf(threads.data ?? [], agent.id)
  return <DialogCard onClose={onClose} className="h-[min(680px,calc(100vh-48px))] w-[560px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-4">
      <Face agent={agent} size={28} />
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">{agent.name}'s threads</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="fade-b no-scrollbar flex min-h-0 flex-1 flex-col gap-px overflow-auto px-3.5 pb-4">
      <ErrorNote message={threads.error?.message} />
      {!threads.data && !threads.error && <Loading />}
      {mine.map((thread) => <ThreadRow key={thread.id} agentId={agent.id} thread={thread} active={false} />)}
      {threads.data && !mine.length && <p className="m-0 px-2 py-6 text-center text-[13px] text-mute">No threads here yet.</p>}
    </div>
  </DialogCard>
}
