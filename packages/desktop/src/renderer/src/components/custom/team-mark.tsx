import { useState } from 'react'
import { useTeamIcon } from '@/features/cloud/workspaces'
import { cn } from '@/lib/utils'

export function TeamMark({ workspace, className }: { workspace: { id: string; name: string; website: string | null }; className?: string }) {
  const icon = useTeamIcon(workspace)
  const [broken, setBroken] = useState<string | null>(null)
  if (icon && broken !== icon) return <img src={icon} alt="" aria-hidden="true" onError={() => setBroken(icon)} className={cn('block size-[26px] shrink-0 rounded-md bg-white object-contain', className)} />
  return <span aria-hidden="true" className={cn('grid size-[26px] shrink-0 place-items-center rounded-md bg-ink text-[13px] font-semibold text-white', className)}>{workspace.name.trim().charAt(0).toUpperCase()}</span>
}
