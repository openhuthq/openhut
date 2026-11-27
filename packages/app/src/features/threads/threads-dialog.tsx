import { useEffect, useState, type KeyboardEvent } from 'react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { threadRoute } from '@/config/paths'
import { useCreateThread, useThreads } from '@/features/threads/api'
import { startedIn, threadsOf, type SourcedThread } from '@/features/threads/places'
import { SourceIcon, ThreadMark, titleOf, useThreadStatus } from '@/features/threads/thread-list'
import { ago } from '@/lib/format'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useMoreBelow } from '@/lib/more-below'

const ROW = 'flex h-10 w-full shrink-0 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] text-ink no-underline hover:bg-soft'

export function ThreadsDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const threads = useThreads()
  const create = useCreateThread(agent.id)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  const list = useMoreBelow<HTMLDivElement>()
  const words = query.trim().toLowerCase()
  const shown = threadsOf({ threads: threads.data ?? [], agent }).filter((thread) => `${titleOf({ agentId: agent.id, thread })} ${thread.preview}`.toLowerCase().includes(words))
  const newThread = () => create.mutate(undefined, { onError: toastError })
  useEffect(() => setPicked(0), [words])
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); newThread() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setPicked((at) => Math.min(shown.length, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1))))
    }
    if (event.key !== 'Enter') return
    const thread = shown[picked - 1]
    if (thread) navigate(threadRoute({ agentId: agent.id, threadId: thread.id }))
    else newThread()
  }
  return <Dialog label={`${agent.name} threads`} onClose={onClose} className="mt-[120px] mb-auto flex h-[min(448px,calc(100vh-160px))] w-[min(720px,calc(100vw-32px))] flex-col rounded-[24px] border border-hair p-0.5 text-[14px]/[20px] shadow-[0_12px_40px_oklch(0%_0_0/.18)]">
    <Input type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} placeholder={`Search ${agent.name} threads`} aria-label={`Search ${agent.name} threads`}
      className="h-[54px] shrink-0 rounded-none border-0 bg-transparent px-5 text-[15px] font-medium placeholder:text-mute focus:border-0" />
    <div ref={list.ref} className={cn('no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2', list.more && 'fade-b-lg')}>
      <Button type="button" variant="bare" className={cn(ROW, picked === 0 && 'bg-soft')} disabled={create.isPending || !agent.canEdit} onMouseEnter={() => setPicked(0)} onClick={newThread}>
        <I icon={PlusSignIcon} size={16} className="text-mute" /><span className="min-w-0 flex-1 truncate">New thread</span>
        <span className="flex gap-1">{['⌘', 'J'].map((key) => <kbd key={key} className="grid h-5 min-w-5 place-items-center rounded-[5px] bg-mid px-[5px] font-sans text-[11.5px] text-body">{key}</kbd>)}</span>
      </Button>
      <h3 className="m-0 mt-3 mb-0.5 flex h-6 items-center px-2.5 text-[14px] font-medium text-mute">Threads</h3>
      <ErrorNote message={threads.error?.message} />
      {shown.map((thread, index) => <PaletteRow key={thread.id} agentId={agent.id} thread={thread} picked={picked === index + 1} onHover={() => setPicked(index + 1)} />)}
      {threads.data && !shown.length && <p className="m-0 px-2.5 py-3 text-[14px] text-mute">{words ? 'No thread matches that.' : 'No threads here yet.'}</p>}
    </div>
  </Dialog>
}

function PaletteRow({ agentId, thread, picked, onHover }: { agentId: string; thread: SourcedThread; picked: boolean; onHover: () => void }) {
  const status = useThreadStatus({ agentId, thread })
  return <a href={threadRoute({ agentId, threadId: thread.id })} onMouseEnter={onHover} className={cn(ROW, picked && 'bg-soft')}>
    <ThreadMark status={status} />
    <span className="min-w-0 flex-1 truncate font-book">{titleOf({ agentId, thread })}</span>
    <SourceIcon thread={thread} size={14} label={startedIn(thread)} />
    <span className="min-w-7 shrink-0 text-right text-mute tabular-nums">{ago(thread.updatedAt)}</span>
  </a>
}
