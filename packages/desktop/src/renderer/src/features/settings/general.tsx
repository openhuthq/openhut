import type { IconSvgElement } from '@hugeicons/react'
import { Alert02Icon, Analytics01Icon, Coffee01Icon, Folder01Icon, Login01Icon, Notification01Icon } from '@hugeicons/core-free-icons'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section } from '@/components/kit'
import { useAdmin, useUpdateAdmin } from '@/features/settings/api'
import { HERE, bytes, desktop, home, useMachine, usePrefs, useSetPrefs, type Prefs } from '@/features/settings/desktop'
import { Intro, Row, Rows } from '@/features/settings/kit'
import { toastError } from '@/lib/toast'

const LOCKED = 'Only an owner or admin changes this'

export function GeneralSettings({ canEdit }: { canEdit: boolean }) {
  const admin = useAdmin()
  return <>
    <Intro>How OpenHut runs on this {HERE}.</Intro>
    <ErrorNote message={admin.error?.message} />
    <Rows>
      {desktop && <PrefSwitch icon={Login01Icon} hue="text-hue-green" name="openAtLogin" title="Open at login" note="Agents start in the background, without opening this window." />}
      {desktop && <PrefSwitch icon={Coffee01Icon} hue="text-hue-amber" name="keepAwake" title={`Keep this ${HERE} awake while agents run`} note="The screen can still turn off. Agents can't answer while it sleeps." />}
    </Rows>
    <Section title="Notify me when">
      <Rows>
        <PrefSwitch icon={Notification01Icon} hue="text-hue-amber" name="notifyReplies" title="An agent replies" note="While this window is closed or in the background." />
        <PrefSwitch icon={Alert02Icon} hue="text-hue-red" name="notifyFailures" title="An agent stops or fails" note="The Dock icon also shows how many agents need you." />
      </Rows>
    </Section>
    <Section title="Data">
      <Rows>
        {desktop && <DataFolder />}
        {admin.data && <UsageData admin={admin.data} canEdit={canEdit} />}
      </Rows>
    </Section>
  </>
}

function PrefSwitch({ icon, hue, name, title, note }: { icon: IconSvgElement; hue: string; name: keyof Prefs; title: string; note: string }) {
  const prefs = usePrefs()
  const setPrefs = useSetPrefs()
  return <Row icon={<I icon={icon} size={20} className={hue} />} title={title} note={note}>
    <Switch checked={!!prefs.data?.[name]} aria-label={title} disabled={!prefs.data || setPrefs.isPending} onCheckedChange={() => prefs.data && setPrefs.mutate({ [name]: !prefs.data[name] }, { onError: toastError })} />
  </Row>
}

function DataFolder() {
  const machine = useMachine()
  if (!machine.data) return <ErrorNote message={machine.error?.message} />
  return <Row icon={<I icon={Folder01Icon} size={20} className="text-hue-blue" />} title={home(machine.data.folder)} note={bytes(machine.data.size)}>
    <Button variant="secondary" className={PILL} onClick={() => void desktop?.showFolder()}>{HERE === 'Mac' ? 'Show in Finder' : 'Open folder'}</Button>
  </Row>
}

function UsageData({ admin, canEdit }: { admin: Admin; canEdit: boolean }) {
  const updateAdmin = useUpdateAdmin()
  const test = admin.seat.mode === 'test'
  return <Row icon={<I icon={Analytics01Icon} size={20} className="text-hue-violet" />} title="Share anonymous usage data" note={test ? 'Test-model builds never send usage data.' : 'Which features are used, never messages, data or your email.'}>
    <Switch checked={admin.usageData} aria-label="Share anonymous usage data" title={canEdit ? undefined : LOCKED} disabled={!canEdit || updateAdmin.isPending}
      onCheckedChange={() => updateAdmin.mutate({ usageData: !admin.usageData }, { onError: toastError })} />
  </Row>
}
