import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { DialogCard } from '@/components/kit'
import { Hut } from '@/components/hut'
import { HERE } from '@/features/settings/desktop'
import { WORDS } from '@/lib/platform'
import { navigate } from '@/lib/router'

export const NOTICE_KEY = 'openhut-where-agents-run'

function unseen() {
  try {
    return !WORDS.sandboxed && !localStorage.getItem(NOTICE_KEY)
  } catch {
    return false
  }
}

export function WhereAgentsRunNotice() {
  const [open, setOpen] = useState(unseen)
  if (!open) return null
  const close = () => {
    try {
      localStorage.setItem(NOTICE_KEY, 'seen')
    } catch {}
    setOpen(false)
  }
  return <DialogCard onClose={close} className="w-[440px]">
    <Hut className="size-12" />
    <DialogTitle className="m-0 text-[18px] font-semibold">Agents now run right on this {HERE}</DialogTitle>
    <div className="flex flex-col gap-2 text-[14px]/[1.5] text-body">
      <p className="m-0">They start in seconds and nothing big downloads. They run as you, like any app you install.</p>
      <p className="m-0">For agents your team uses, add a server. There each agent gets its own sandbox.</p>
    </div>
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={() => { close(); navigate('/settings/devices') }}>Add a computer</Button>
      <Button type="button" variant="primary" className="ml-auto" autoFocus onClick={close}>OK</Button>
    </div>
  </DialogCard>
}
