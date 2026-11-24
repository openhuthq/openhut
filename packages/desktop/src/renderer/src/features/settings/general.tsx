import type { IconSvgElement } from '@hugeicons/react'
import { Coffee01Icon, Login01Icon } from '@hugeicons/core-free-icons'
import { Switch } from '@/components/ui/switch'
import { I, Section } from '@/components/kit'
import { usePrefs, useSetPrefs, type Prefs } from '@/features/settings/desktop'
import { desktop } from '@/lib/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { TeamDangerRows, TeamSettings } from '@/features/people/workspace'
import { DeleteAccountRow, YouSettings } from '@/features/cloud/cloud'
import { toastError } from '@/lib/toast'

export function GeneralSettings() {
  return <>
    <TeamSettings />
    <YouSettings />
    {desktop && <Rows>
      <PrefSwitch icon={Login01Icon} hue="text-hue-green" name="openAtLogin" title="Open at login" note="Agents start in the background, without opening this window." />
      <PrefSwitch icon={Coffee01Icon} hue="text-hue-amber" name="keepAwake" title="Keep this computer awake" note="While agents run, so they keep answering. The screen can still turn off." />
    </Rows>}
    <Section title="Danger zone">
      <Rows><TeamDangerRows /><DeleteAccountRow /></Rows>
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
