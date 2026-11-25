import type { IconSvgElement } from '@hugeicons/react'
import { Coffee01Icon, Login01Icon } from '@hugeicons/core-free-icons'
import { Switch } from '@/components/ui/switch'
import { I, Section } from '@/components/kit'
import { usePrefs, useSetPrefs, type Prefs } from '@/features/settings/desktop'
import { desktop } from '@/lib/desktop'
import { Row, Rows } from '@/features/settings/kit'
import { ResetEncryptionRow, TeamDangerRows, TeamSettings } from '@/features/people/workspace'
import { DeleteAccountRow, SignInRows, YouSettings } from '@/features/cloud/cloud'
import { toastError } from '@/lib/toast'
import { useWorkspaces } from '@/features/cloud/workspaces'
import { EncryptionRow, useEncryption } from '@/features/settings/encryption'

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

export function SecuritySettings() {
  const admin = useWorkspaces().active.role !== 'member'
  return <>
    <Section title="Getting in"><Rows><EncryptionRow />{useEncryption() && <SignInRows />}</Rows></Section>
    {admin && <Section title="Encryption"><Rows><ResetEncryptionRow /></Rows></Section>}
  </>
}

export function PrefSwitch({ icon, hue, name, title, note }: { icon: IconSvgElement; hue: string; name: keyof Prefs; title: string; note?: string }) {
  const prefs = usePrefs()
  const setPrefs = useSetPrefs()
  return <Row icon={<I icon={icon} size={20} className={hue} />} title={title} note={note}>
    <Switch checked={!!prefs.data?.[name]} aria-label={title} disabled={!prefs.data || setPrefs.isPending} onCheckedChange={() => prefs.data && setPrefs.mutate({ [name]: !prefs.data[name] }, { onError: toastError })} />
  </Row>
}
