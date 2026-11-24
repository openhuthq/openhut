import { BrowserIcon, CloudDownloadIcon, LaptopIcon, ServerStack01Icon, TestTube01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { I, PILL } from '@/components/kit'
import { adminOf, startUpdate, useComputerAdmins, type ComputerAdmin } from '@/features/computers/api'
import { usePrefs } from '@/features/settings/desktop'
import { desktop } from '@/lib/desktop'
import { PrefSwitch } from '@/features/settings/general'
import { Row, Rows } from '@/features/settings/kit'
import { downloadUrl, updateDetails, updateNote, useAppUpdate, type UpdateState } from '@/features/settings/update'
import { updateServers } from '@/features/settings/update-all'
import { CheckButton, UpdatePill } from '@/features/settings/update-pill'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { WORDS } from '@/lib/platform'
import { toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'

const WHATS_NEW = 'https://github.com/openhuthq/openhut/releases'

export function UpdatesSettings() {
  const admins = (useComputerAdmins().data ?? []).filter(({ computer, admin }) => admin && !(desktop && computer.id === 'local'))
  const latest = useAppUpdate().data?.available
  return <>
    <p className="m-0 -mt-3 px-2.5 text-[12px]/[16px] text-mute">{latest ? `Latest: OpenHut ${latest} · ` : ''}<a href={WHATS_NEW} target="_blank" rel="noreferrer" className="text-hue-blue no-underline hover:underline">What’s new</a></p>
    <Rows>
      {desktop ? <ThisApp /> : <Row icon={<I icon={BrowserIcon} size={20} className="text-hue-sky" />} title="This app · Web" note="Always the latest" />}
      {admins.map((each) => <ComputerRow key={each.computer.id} each={each} />)}
    </Rows>
    {desktop && <BetaSwitch />}
  </>
}

function ThisApp() {
  const state = useAppUpdate().data
  if (!state) return null
  return <>
    <Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title={`${WORDS.thisComputer} · OpenHut ${state.current}`} note={updateNote(state)}><Action state={state} /></Row>
    <Details state={state} />
  </>
}

function BetaSwitch() {
  const state = useAppUpdate().data
  const prefs = usePrefs()
  const stays = !!state?.current.includes('-') && prefs.data?.betaUpdates === false
  return <Rows><PrefSwitch icon={TestTube01Icon} hue="text-hue-violet" name="betaUpdates" title="Try new features early" note={stays ? 'You stay on this beta until the next regular version is out.' : 'Get beta versions before everyone else.'} /></Rows>
}

function ComputerRow({ each: { computer, admin } }: { each: ComputerAdmin }) {
  const client = useQueryClient()
  const run = useMutation({
    mutationFn: () => updateServers({ servers: [computer], steps: { start: startUpdate, read: (server) => adminOf(server.id), say: () => undefined, wait: () => new Promise((resolve) => setTimeout(resolve, 3000)), limit: 900 } }),
    onSuccess: ([outcome]) => outcome && !outcome.ok && toastFailed(`${computer.name} didn’t update`, outcome.reason ?? undefined),
    onError: toastError,
    onSettled: () => void client.invalidateQueries({ queryKey: COMPUTERS_KEY }),
  })
  if (!admin) return null
  const { version, updateAvailable } = admin.server
  return <Row icon={<I icon={computer.kind === 'server' ? ServerStack01Icon : LaptopIcon} size={20} className="text-hue-blue" />} title={computer.name} note={updateAvailable ? `OpenHut ${version} · a new version is out` : `OpenHut ${version}`}>
    {run.isPending && <Spinner className="mt-0" />}
    {!run.isPending && updateAvailable && <Button type="button" variant="secondary" className={PILL} onClick={() => run.mutate()}>Update now</Button>}
    {!run.isPending && !updateAvailable && <span className="inline-flex items-center gap-1 text-mute"><I icon={Tick02Icon} size={14} />Up to date</span>}
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
  if (!state.error) return <CheckButton label="Check for updates" />
  return <>
    <a href={downloadUrl(desktop?.platform)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'ghost' }), PILL, 'text-mute')}>Download</a>
    <CheckButton label="Try again" />
  </>
}
