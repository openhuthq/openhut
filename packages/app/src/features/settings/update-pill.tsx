import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Hut } from '@/components/hut'
import { toastError, toastFailed } from '@/lib/toast'
import { adminOf, startUpdate, useComputerAdmins, useComputers } from '@/features/computers/api'
import { behind, updateServers } from '@/features/settings/update-all'
import { COMPUTERS_KEY } from '@/lib/query-keys'

export function UpdateEverything() {
  const computers = useComputers().data ?? []
  const admins = useComputerAdmins().data ?? []
  const client = useQueryClient()
  const [doing, setDoing] = useState('')
  const servers = behind({ computers, admins })
  const run = useMutation({
    mutationFn: async () => {
      const outcomes = await updateServers({
        servers,
        steps: { start: startUpdate, read: (server) => adminOf(server.id), say: setDoing, wait: () => new Promise((resolve) => setTimeout(resolve, 3000)), limit: 900 },
      })
      void client.invalidateQueries({ queryKey: COMPUTERS_KEY })
      const failed = outcomes.filter((outcome) => !outcome.ok)
      for (const outcome of failed) toastFailed(`${outcome.name} didn’t update`, outcome.reason ?? undefined)
    },
    onError: toastError,
    onSettled: () => setDoing(''),
  })
  if (!servers.length) return null
  const what = [...servers.map((server) => `${server.name} → ${admins.find((each) => each.computer.id === server.id)?.admin?.server.latestBuild ?? 'latest'}`)].filter(Boolean).join(', ')
  if (run.isPending) return <UpdateCard hut={<Hut className="size-11 [&>svg]:animate-[hop_1.2s_ease-in-out_infinite]" />} title={doing || 'Updating…'} note="Your agents keep working" />
  return <UpdateCard hut={<Hut className="size-11 animate-[tilein_.4s_cubic-bezier(.3,1.4,.5,1)]" />} title="Update available" note="Your agents keep working">
    <Button type="button" variant="primary" className="w-full justify-center" title={what} aria-label={`Update: ${what}`} onClick={() => run.mutate()}>Update</Button>
  </UpdateCard>
}

function UpdateCard({ hut, title, note, children }: { hut?: ReactNode; title: string; note: string; children?: ReactNode }) {
  return <section aria-live="polite" className="flex w-full animate-grow flex-col gap-3 rounded-lg border border-hair bg-card p-3">
    <div className="flex items-center gap-3">
      {hut}
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[13px] text-body">{note}</span>
      </div>
    </div>
    {children}
  </section>
}
