import { useEffect, useRef, useState } from 'react'
import { Alert02Icon, CloudUploadIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { Backup } from '@openhut/common/cloud/cloud.ts'
import { I } from '@/components/kit'
import { Meter } from '@/components/ui/meter'
import { useCloud } from '@/features/cloud/api'
import { isPhone } from '@/lib/native'

const SHOW_DONE_MS = 60_000

export function BackupCard() {
  const cloud = useCloud().data
  const backup = cloud?.backup
  const previous = useRef<Backup | undefined>(undefined)
  const [doneAt, setDoneAt] = useState<number | null>(null)
  useEffect(() => {
    const before = previous.current
    previous.current = backup
    const watched = before?.state === 'backing_up' || before?.state === 'failed' || (before?.state === 'idle' && before.at === null)
    if (before && backup?.state === 'idle' && backup.at && backup.at !== before.at && watched) setDoneAt(Date.now())
  }, [backup])
  useEffect(() => {
    if (doneAt === null) return
    const timer = setTimeout(() => setDoneAt(null), SHOW_DONE_MS)
    return () => clearTimeout(timer)
  }, [doneAt])
  if (isPhone() || !cloud || !backup || cloud.status === 'off' || cloud.status === 'locked') return null
  const { state, done, total } = backup
  const busy = state === 'backing_up'
  const failed = state === 'failed'
  if (!busy && !failed && doneAt === null) return null
  const percent = (busy || failed) && total ? Math.round((done / total) * 100) : 100
  const icon = failed ? <I icon={Alert02Icon} size={15} className="text-fail" /> : busy ? <I icon={CloudUploadIcon} size={15} /> : <I icon={Tick02Icon} size={15} className="text-success" />
  return <div className="flex w-full flex-col gap-2 rounded-xl border border-hair bg-card px-3.5 py-3 shadow-[0_2px_8px_oklch(0%_0_0/.06)]" role="status">
    <span className="flex items-center gap-2 text-[13px] font-medium">
      {icon}{failed ? 'Couldn’t back up' : busy ? 'Backing up' : 'Backed up'}
      <span className="ml-auto text-[12px] font-normal text-mute tabular-nums">{busy ? `${percent}%` : failed ? (backup.problem ? '' : 'Trying again') : 'Just now'}</span>
    </span>
    <Meter value={percent} done={!busy && !failed} aria-label="Backup" />
    <span className="text-[11.5px] text-mute">{failed ? `${total - done} of ${total} not backed up yet` : busy ? `${done} of ${total} agents and settings` : 'Only your devices can read it.'}</span>
  </div>
}
