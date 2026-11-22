import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { Meter } from '@/components/ui/meter'
import { Spinner } from '@/components/ui/spinner'
import { PILL } from '@/components/kit'
import { UPDATE_KEY, downloadUrl, progressTitle, readyNote, updates, useAppUpdate } from '@/features/settings/update'
import { Hut } from '@/components/hut'
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
  if (state?.ready) return <UpdatePill />
  if (!state?.error) return state?.checking || state?.available ? <Spinner className="mt-0" /> : idle
  return <span className="inline-flex gap-1.5">
    <a href={downloadUrl(Reflect.get(window, 'openhut')?.platform)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Download</a>
    <CheckButton label="Retry" />
  </span>
}

export function CheckButton({ label }: { label: string }) {
  const client = useQueryClient()
  const check = useMutation({ mutationFn: async () => updates?.check(), onSuccess: (next) => next && client.setQueryData(UPDATE_KEY, next), onError: toastError })
  return <Button type="button" variant="ghost" className={PILL} disabled={check.isPending} onClick={() => check.mutate()}>{label}</Button>
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
  const downloading = !!app?.available && !app.ready && !app.error
  if (!app?.ready && !servers.length && !downloading) return null
  const what = [app?.ready && `${HERE_NAME} → ${app.ready.version}`, ...servers.map((server) => `${server.name} → ${admins.find((each) => each.computer.id === server.id)?.admin?.server.latestBuild ?? 'latest'}`)].filter(Boolean).join(', ')
  if (run.isPending) return <UpdateCard hut={<Hut className="size-11 [&>svg]:animate-[hop_1.2s_ease-in-out_infinite]" />} title={doing || 'Updating…'} note="Your agents keep working" />
  if (downloading) return <UpdateCard title={progressTitle(app.progress)} note={`${app.available} · your agents keep working`}><Rider progress={app.progress ?? 0} /></UpdateCard>
  const label = app?.ready ? (servers.length ? 'Update and restart' : 'Restart') : 'Update'
  return <UpdateCard hut={<Hut className="size-11 animate-[tilein_.4s_cubic-bezier(.3,1.4,.5,1)]" />} title={app?.ready ? 'All fixed up' : 'Something new for you'} note={app?.ready ? `Version ${app.ready.version} is ready` : 'Your agents keep working'}>
    <Button type="button" variant="primary" className="w-full justify-center" title={what} aria-label={`${label}: ${what}`} onClick={() => run.mutate()}>{label}</Button>
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

function Rider({ progress }: { progress: number }) {
  const at = Math.max(progress, 4)
  return <div className="relative -mt-1 h-10">
    <Meter className="absolute inset-x-0 bottom-1 h-2 rounded-full bg-soft" value={at} aria-label="Update progress" />
    <Hut className="absolute bottom-2 size-[30px] transition-[left] duration-300 [&>svg]:animate-[hop_1.2s_ease-in-out_infinite]" style={{ left: `calc(${at}% - ${at * 0.3}px)` }} />
  </div>
}
