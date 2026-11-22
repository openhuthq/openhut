import type { IconSvgElement } from '@hugeicons/react'
import { ChartColumnIcon, Coffee01Icon, Folder01Icon, Login01Icon } from '@hugeicons/core-free-icons'
import type { Admin } from '@openhut/common/admin/admin.ts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section } from '@/components/kit'
import { useAdmin, useUpdateAdmin } from '@/features/settings/api'
import { bytes, desktop, useMachine, usePrefs, useSetPrefs, type Prefs } from '@/features/settings/desktop'
import { home } from '@/features/settings/home'
import { Row, Rows } from '@/features/settings/kit'
import { WORDS } from '@/lib/platform'
import { toastError } from '@/lib/toast'

export function GeneralSettings() {
  const admin = useAdmin()
  return <>
    <ErrorNote message={admin.error?.message} />
    <Rows>
      {desktop && <PrefSwitch icon={Login01Icon} hue="text-hue-green" name="openAtLogin" title="Open at login" note="Agents start in the background, without opening this window." />}
      {desktop && <PrefSwitch icon={Coffee01Icon} hue="text-hue-amber" name="keepAwake" title="Keep this computer awake" note="While agents run, so they keep answering. The screen can still turn off." />}
    </Rows>
    <Section title="Data">
      <Rows>
        {desktop && <DataFolder />}
        {admin.data && <UsageData admin={admin.data} />}
      </Rows>
    </Section>
  </>
}

export function PrefSwitch({ icon, hue, name, title, note }: { icon: IconSvgElement; hue: string; name: keyof Prefs; title: string; note?: string }) {
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
  return <Row icon={<I icon={ChartColumnIcon} size={20} className="text-hue-violet" />} title="Share anonymous usage data" note={test ? 'Off in test builds.' : 'Which features you use. Never your messages or files.'}>
    <Switch checked={admin.usageData} aria-label="Share anonymous usage data" disabled={updateAdmin.isPending}
      onCheckedChange={() => updateAdmin.mutate({ usageData: !admin.usageData }, { onError: toastError })} />
  </Row>
}
