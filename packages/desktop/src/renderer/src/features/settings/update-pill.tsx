import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PILL } from '@/components/kit'
import { UPDATE_KEY, downloadUrl, readyNote, updates, useAppUpdate } from '@/features/settings/update'
import { toast, toastError } from '@/lib/toast'
import { adminOf, startUpdate, useComputerAdmins, useComputers } from '@/features/computers/api'
import { behind, updateServers } from '@/features/settings/update-all'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { WORDS } from '@/lib/platform'

const HERE_NAME = WORDS.thisComputer
import { cn } from '@/lib/utils'

export function UpdatePill({ className }: { className?: string }) {
  const note = readyNote(useAppUpdate().data)
  const install = useMutation({ mutationFn: async () => updates?.install(), onError: toastError })
  if (!note) return null
  return <Button type="button" variant="secondary" className={cn(PILL, className)} title={note} aria-label={`Restart to update. ${note}.`} disabled={install.isPending} onClick={() => install.mutate()}>Restart to update</Button>
}

export function UpdateStatus({ idle }: { idle: ReactNode }) {
  const state = useAppUpdate().data
  const client = useQueryClient()
  const check = useMutation({ mutationFn: async () => updates?.check(), onSuccess: (next) => next && client.setQueryData(UPDATE_KEY, next), onError: toastError })
  if (state?.ready) return <UpdatePill />
  if (!state?.error) return state?.checking || state?.available ? <Spinner className="mt-0" /> : idle
  return <span className="inline-flex gap-1.5">
    <a href={downloadUrl(Reflect.get(window, 'openhut')?.platform)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Download</a>
    <Button type="button" variant="ghost" className={PILL} disabled={check.isPending} onClick={() => check.mutate()}>Check now</Button>
  </span>
}

export function UpdateEverything() {
  const app = useAppUpdate().data
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
      if (failed.length) toast(failed.map((outcome) => `${outcome.name} didn't update: ${outcome.reason}`).join(' '))
      if (app?.ready) {
        setDoing('Restarting…')
        await updates?.install()
      }
    },
    onError: toastError,
    onSettled: () => setDoing(''),
  })
  if (!app?.ready && !servers.length) return null
  const downloading = !!app?.available && !app.ready && !app.error
  const what = [app?.ready && `${HERE_NAME} → ${app.ready.version}`, ...servers.map((server) => `${server.name} → ${admins.find((each) => each.computer.id === server.id)?.admin?.server.latestBuild ?? 'latest'}`)].filter(Boolean).join(', ')
  const label = doing || (downloading ? 'Downloading update…' : 'Update')
  return <Button type="button" variant="secondary" className={PILL} title={what} aria-label={`${label} ${what}`} disabled={run.isPending || downloading} onClick={() => run.mutate()}>{label}</Button>
}
