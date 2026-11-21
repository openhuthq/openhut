import { CloudUploadIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Meter } from '@/components/ui/meter'
import { justBackedUp, useCloud } from '@/features/cloud/api'
import { isPhone } from '@/lib/native'

export function BackupCard() {
  const cloud = useCloud().data
  if (isPhone() || !cloud || cloud.status === 'off' || cloud.status === 'locked') return null
  const { state, done, total } = cloud.backup
  const busy = state === 'backing_up'
  if (!busy && !justBackedUp(cloud)) return null
  const percent = busy && total ? Math.round((done / total) * 100) : 100
  return <div className="flex w-full flex-col gap-2 rounded-xl border border-hair bg-card px-3.5 py-3 shadow-[0_2px_8px_oklch(0%_0_0/.06)]" role="status">
    <span className="flex items-center gap-2 text-[13px] font-medium">
      {busy ? <I icon={CloudUploadIcon} size={15} /> : <I icon={Tick02Icon} size={15} className="text-success" />}{busy ? 'Backing up' : 'Backed up'}
      <span className="ml-auto text-[12px] font-normal text-mute tabular-nums">{busy ? `${percent}%` : 'Just now'}</span>
    </span>
    <Meter value={percent} done={!busy} aria-label="Backup" />
    <span className="text-[11.5px] text-mute">{busy ? `${done} of ${total} agents and settings` : 'Only your devices can read it.'}</span>
  </div>
}
