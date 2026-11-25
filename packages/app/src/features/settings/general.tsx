import { PILL, Section } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { useSignOut } from '@/features/auth/api'
import { toastError } from '@/lib/toast'
import { PersonFace } from '@/components/custom/person-face'
import { useOwner } from '@/features/people/api'
import { Row, Rows } from '@/features/settings/kit'
import { personName } from '@/lib/format'

export function GeneralSettings() {
  const email = useOwner()
  const signOut = useSignOut()
  return <Section title="You">
    <Rows>
      <Row icon={<PersonFace name={personName(email)} email={email} size={20} />} title={personName(email)} note={email}>
        <Button type="button" variant="secondary" className={PILL} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onError: toastError })}>Sign out</Button>
      </Row>
    </Rows>
  </Section>
}
