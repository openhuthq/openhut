import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { PILL } from '@/components/kit'
import { readyNote, updates, useAppUpdate } from '@/features/settings/update'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function UpdatePill({ className }: { className?: string }) {
  const note = readyNote(useAppUpdate().data)
  const install = useMutation({ mutationFn: async () => updates?.install(), onError: toastError })
  if (!note) return null
  return <Button type="button" variant="secondary" className={cn(PILL, className)} title={note} aria-label={`Restart to update. ${note}.`} disabled={install.isPending} onClick={() => install.mutate()}>Restart to update</Button>
}

export function UpdateStatus() {
  const state = useAppUpdate().data
  if (state?.ready) return <UpdatePill />
  return <span className="text-mute">Up to date</span>
}
