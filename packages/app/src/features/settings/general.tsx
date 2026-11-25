import { Section } from '@/components/kit'
import { Rows } from '@/features/settings/kit'
import { TeamDangerRows, TeamSettings } from '@/features/people/workspace'
import { DeleteAccountRow, SignInWays, YouSettings } from '@/features/cloud/cloud'

export function GeneralSettings() {
  return <>
    <TeamSettings />
    <YouSettings />
    <SignInWays />
    <Section title="Danger zone">
      <Rows><TeamDangerRows /><DeleteAccountRow /></Rows>
    </Section>
  </>
}
