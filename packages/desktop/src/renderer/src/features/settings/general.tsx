import type { IconSvgElement } from '@hugeicons/react'
import { Alert02Icon, ChartColumnIcon, Coffee01Icon, Folder01Icon, Login01Icon, Notification01Icon, CloudDownloadIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section, Status } from '@/components/kit'
import { useAdmin, useUpdateAdmin } from '@/features/settings/api'
import { WorkspaceDanger, WorkspaceSettings } from '@/features/people/workspace'
import { HERE, bytes, desktop, useMachine, usePrefs, useSetPrefs, type Prefs } from '@/features/settings/desktop'
import { home } from '@/features/settings/home'
import { Row, Rows } from '@/features/settings/kit'
import { isPhone } from '@/lib/native'
import { WORDS } from '@/lib/platform'
import { updateNote, useAppUpdate } from '@/features/settings/update'
import { UpdateStatus } from '@/features/settings/update-pill'
import { toastError } from '@/lib/toast'

export function GeneralSettings() {
  const admin = useAdmin()
  return <>
    <WorkspaceSettings />
    <ErrorNote message={admin.error?.message} />
    <Rows>
      {desktop && <PrefSwitch icon={Login01Icon} hue="text-hue-green" name="openAtLogin" title="Open at login" note="Agents start in the background, without opening this window." />}
      {desktop && <PrefSwitch icon={Coffee01Icon} hue="text-hue-amber" name="keepAwake" title={`Keep this ${HERE} awake while agents run`} note={`The screen can still turn off. Agents can't answer while the ${HERE} sleeps.`} />}
      <Version />
      <Vault />
    </Rows>
    {!isPhone() && <Section title="Notify me when">
      <Rows>
        <PrefSwitch icon={Notification01Icon} hue="text-hue-amber" name="notifyReplies" title="An agent replies" note="While this window is closed or in the background." />
        <PrefSwitch icon={Alert02Icon} hue="text-hue-red" name="notifyFailures" title="An agent stops or fails" note={WORDS.badgeNote} />
      </Rows>
    </Section>}
    <Section title="Data">
      <Rows>
        {desktop && <DataFolder />}
        {admin.data && <UsageData admin={admin.data} />}
      </Rows>
    </Section>
    <WorkspaceDanger />
  </>
}

function Version() {
  const state = useAppUpdate().data
  if (!state) return null
  return <Row icon={<I icon={CloudDownloadIcon} size={20} className="text-hue-sky" />} title={`OpenHut ${state.current}`} note={updateNote(state)}><UpdateStatus idle={<Status tone="on">Up to date</Status>} /></Row>
}

function Vault() {
  const hash: string = import.meta.env.VITE_VAULT_SHA256 ?? ''
  return <Row icon={<I icon={SquareLock02Icon} size={20} className="text-hue-green" />} title="Vault" note={<span className="font-mono break-all">SHA-256 {hash}</span>}>
    <CopyButton text={hash} label="Copy" variant="ghost" className={PILL} />
  </Row>
}

function PrefSwitch({ icon, hue, name, title, note }: { icon: IconSvgElement; hue: string; name: keyof Prefs; title: string; note?: string }) {
  const prefs = usePrefs()
  const setPrefs = useSetPrefs()
  return <Row icon={<I icon={icon} size={20} className={hue} />} title={title} note={note}>
    <Switch checked={!!prefs.data?.[name]} aria-label={title} disabled={!prefs.data || setPrefs.isPending} onCheckedChange={() => prefs.data && setPrefs.mutate({ [name]: !prefs.data[name] }, { onError: toastError })} />
  </Row>
}

function DataFolder() {
  const machine = useMachine()
  if (!machine.data) return <ErrorNote message={machine.error?.message} />
  return <Row icon={<I icon={Folder01Icon} size={20} className="text-hue-blue" />} title="Data folder" note={`${home(machine.data.folder)} · ${bytes(machine.data.size)}`}>
    <Button variant="ghost" className={PILL} onClick={() => void desktop?.showFolder()}>{WORDS.showFolder}</Button>
  </Row>
}

function UsageData({ admin }: { admin: Admin }) {
  const updateAdmin = useUpdateAdmin()
  const test = admin.seat.mode === 'test'
  return <Row icon={<I icon={ChartColumnIcon} size={20} className="text-hue-violet" />} title="Share anonymous usage data" note={test ? 'Test-model builds never send usage data.' : 'Which features you use. Never your messages or files.'}>
    <Switch checked={admin.usageData} aria-label="Share anonymous usage data" disabled={updateAdmin.isPending}
      onCheckedChange={() => updateAdmin.mutate({ usageData: !admin.usageData }, { onError: toastError })} />
  </Row>
}
