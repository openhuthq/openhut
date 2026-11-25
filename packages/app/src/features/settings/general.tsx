import { Section } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { useOwner } from '@/features/people/api'
import { Row, Rows } from '@/features/settings/kit'
import { personName } from '@/lib/format'

export function GeneralSettings() {
  const email = useOwner()
  return <Section title="You">
    <Rows>
      <Row icon={<PersonFace name={personName(email)} email={email} size={20} />} title={personName(email)} note={email} />
    </Rows>
  </Section>
}
