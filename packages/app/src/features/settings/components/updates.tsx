import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { I } from '@/components/kit'
import { adminOf, startUpdate } from '@/lib/queries/computers'
import { updateServers } from '@/features/settings/update-all'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { POLL_MS, updatesQuery } from '@/features/settings/api/updates'

const WHATS_NEW = 'https://openhut.dev/changelog'
const INSTALL = { id: 'install', name: 'OpenHut' }

export function UpdatesSettings() {
  const client = useQueryClient()
  const admin = useQuery(updatesQuery)
  const run = useMutation({
    mutationFn: () => updateServers({ servers: [INSTALL], steps: { start: startUpdate, read: adminOf, say: () => undefined, wait: () => new Promise((resolve) => setTimeout(resolve, POLL_MS)), limit: 900 } }),
    onSuccess: ([outcome]) => outcome && !outcome.ok && toastFailed('OpenHut didn’t update', sentence(outcome.reason)),
    onError: toastError,
    onSettled: () => void client.invalidateQueries({ queryKey: COMPUTERS_KEY }),
  })
  const server = admin.data?.server
  if (!server) return admin.isPending ? <Spinner /> : <ErrorNote message="Couldn’t reach OpenHut. Try again in a minute." />
  const running = run.isPending || server.update?.status === 'running'
  const failed = !running && server.update?.status === 'failed' ? server.update : null
  const to = server.update?.to ?? server.latestBuild
  const ready = running || !!failed || server.updateAvailable
  return <>
    <div className="flex items-center gap-3 px-2.5">
      <Hut mood={ready ? undefined : 'happy'} className={cn('size-11', running && '[&>svg]:animate-[hop_1.2s_ease-in-out_infinite]')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px]/[20px] font-medium">{titleOf({ server, running, failed: !!failed, to })}</span>
        <span className="text-[12.5px]/[18px] text-mute">{running ? 'OpenHut restarts once. Agents pick up where they left off.' : <>OpenHut {server.build}{ready && to && ` → ${to}`} · <a href={WHATS_NEW} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-hue-blue no-underline hover:underline">What’s new<I icon={ArrowUpRight01Icon} size={12} /></a></>}</span>
      </div>
      {running && <Spinner className="mt-0" />}
      {!running && (failed || server.updateAvailable) && <Button type="button" variant="primary" onClick={() => run.mutate()}>{failed ? 'Try again' : 'Update now'}</Button>}
    </div>
    {failed && <ErrorNote message={sentence(failed.reason) ?? 'The update stopped before it finished.'} />}
  </>
}

function titleOf({ server, running, failed, to }: { server: Admin['server']; running: boolean; failed: boolean; to: string | null }) {
  if (running) return `Updating to ${to}…`
  if (failed) return `Couldn’t update to ${to}`
  return server.updateAvailable ? 'An update is ready' : 'Everything is up to date'
}

function sentence(text: string | null | undefined) {
  if (!text) return undefined
  const said = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(said) ? said : `${said}.`
}
