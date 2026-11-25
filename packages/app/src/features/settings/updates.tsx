import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Hut } from '@/components/hut'
import { I, PILL } from '@/components/kit'
import { deviceIcon, DEVICE_HUE } from '@/components/custom/device'
import { adminOf, startUpdate, useComputerAdmins, type ComputerAdmin } from '@/features/computers/api'
import { Row, Rows } from '@/features/settings/kit'
import { updateServers } from '@/features/settings/update-all'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { toastError, toastFailed } from '@/lib/toast'

const WHATS_NEW = 'https://openhut.dev/changelog'
const WEB_VERSION: string | undefined = import.meta.env.OPENHUT_VERSION

export function UpdatesSettings() {
  const others = (useComputerAdmins().data ?? []).filter(({ admin }) => admin)
  const behind = others.filter(({ admin }) => admin?.server.updateAvailable)
  const version = WEB_VERSION
  const count = behind.length
  return <>
    <div className="flex items-center gap-3 px-2.5">
      <Hut mood={count ? undefined : 'happy'} className="size-11" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px]/[20px] font-medium">{statusOf(count)}</span>
        <span className="text-[12.5px]/[18px] text-mute">{version && `OpenHut ${version} · `}<a href={WHATS_NEW} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-hue-blue no-underline hover:underline">What’s new<I icon={ArrowUpRight01Icon} size={12} /></a></span>
      </div>
    </div>
    {count > 0 && <Rows>
      {behind.map((each) => <ComputerRow key={each.computer.id} each={each} latest={version} />)}
    </Rows>}
    {!count && others.length > 0 && <p className="m-0 -mt-6 px-2.5 text-[12px]/[16px] text-mute">{others.length === 1 ? `${others[0].computer.name} checked` : `${others.length} computers checked`}</p>}
  </>
}

function statusOf(count: number) {
  if (!count) return 'Everything is up to date'
  return count === 1 ? 'An update is ready' : `${count} updates are ready`
}

function ComputerRow({ each: { computer, admin }, latest }: { each: ComputerAdmin; latest: string | undefined }) {
  const client = useQueryClient()
  const run = useMutation({
    mutationFn: () => updateServers({ servers: [computer], steps: { start: startUpdate, read: (server) => adminOf(server.id), say: () => undefined, wait: () => new Promise((resolve) => setTimeout(resolve, 3000)), limit: 900 } }),
    onSuccess: ([outcome]) => outcome && !outcome.ok && toastFailed(`${computer.name} didn’t update`, outcome.reason ?? undefined),
    onError: toastError,
    onSettled: () => void client.invalidateQueries({ queryKey: COMPUTERS_KEY }),
  })
  if (!admin) return null
  const { version } = admin.server
  return <Row icon={<I icon={deviceIcon(computer)} size={20} className={DEVICE_HUE} />} title={`${computer.name} · OpenHut ${version}${latest && latest !== version ? ` → ${latest}` : ''}`} note={latest && latest !== version ? undefined : 'A newer build is out'}>
    {run.isPending ? <Spinner className="mt-0" /> : <Button type="button" variant="secondary" className={PILL} onClick={() => run.mutate()}>Update now</Button>}
  </Row>
}
