import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Hut } from '@/components/hut'
import { I, PILL } from '@/components/kit'
import { deviceIcon, DEVICE_HUE } from '@/components/custom/device'
import { adminOf, startUpdate, useComputerAdmins, type ComputerAdmin } from '@/features/computers/api'
import { desktop } from '@/lib/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { downloadUrl, updateDetails, updateNote, useAppUpdate, type UpdateState } from '@/features/settings/update'
import { updateServers } from '@/features/settings/update-all'
import { CheckButton, UpdatePill } from '@/features/settings/update-pill'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { WORDS } from '@/lib/platform'
import { toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'

const WHATS_NEW = 'https://openhut.dev/changelog'
const WEB_VERSION: string | undefined = import.meta.env.OPENHUT_VERSION

export function UpdatesSettings() {
  const app = useAppUpdate().data
  const others = (useComputerAdmins().data ?? []).filter(({ computer, admin }) => admin && !(desktop && computer.id === 'local'))
  const behind = others.filter(({ admin }) => admin?.server.updateAvailable)
  const appNeeds = !!app && (!!app.ready || !!app.error || !!app.available || !!app.halted || !!app.waiting)
  const version = desktop ? app?.current : WEB_VERSION
  const count = behind.length + (appNeeds ? 1 : 0)
  return <>
    <div className="flex items-center gap-3 px-2.5">
      <Hut mood={count ? undefined : 'happy'} className="size-11" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px]/[20px] font-medium">{statusOf(count)}</span>
        <span className="text-[12.5px]/[18px] text-mute">{version && `OpenHut ${version} · `}<a href={WHATS_NEW} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-hue-blue no-underline hover:underline">What’s new<I icon={ArrowUpRight01Icon} size={12} /></a></span>
      </div>
      {desktop && !appNeeds && (app?.checking ? <Spinner className="mt-0" /> : <CheckButton label="Check for updates" />)}
    </div>
    {count > 0 && <Rows>
      {appNeeds && app && <ThisApp state={app} />}
      {behind.map((each) => <ComputerRow key={each.computer.id} each={each} latest={version} />)}
    </Rows>}
    {!count && others.length > 0 && <p className="m-0 -mt-6 px-2.5 text-[12px]/[16px] text-mute">{others.length === 1 ? `${others[0].computer.name} checked` : `${others.length} computers checked`}</p>}
  </>
}

function statusOf(count: number) {
  if (!count) return 'Everything is up to date'
  return count === 1 ? 'An update is ready' : `${count} updates are ready`
}

function ThisApp({ state }: { state: UpdateState }) {
  const to = state.ready?.version ?? state.available ?? state.waiting?.version
  return <>
    <Row icon={<I icon={deviceIcon({ kind: 'mac' })} size={20} className={DEVICE_HUE} />} title={`${WORDS.thisComputer} · OpenHut ${state.current}${to ? ` → ${to}` : ''}`} note={updateNote(state)}><Action state={state} /></Row>
    <Details state={state} />
  </>
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

function Details({ state }: { state: UpdateState }) {
  const details = updateDetails(state)
  if (!details) return null
  return <details className="px-3 text-[12px]/[16px] text-mute">
    <summary className="cursor-default">Details</summary>
    <div>Release key {details.key}</div>
    <div>Log entry <a href={details.entry} target="_blank" rel="noreferrer" className="underline">{details.logIndex}</a></div>
    <ul>{details.checks.map((check) => <li key={check}>✓ {check}</li>)}</ul>
  </details>
}

function Action({ state }: { state: UpdateState }) {
  if (state.ready) return <UpdatePill />
  if (state.checking || state.available) return <Spinner className="mt-0" />
  if (!state.error) return null
  return <>
    <a href={downloadUrl(desktop?.platform)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'ghost' }), PILL, 'text-mute')}>Download</a>
    <CheckButton label="Try again" />
  </>
}
