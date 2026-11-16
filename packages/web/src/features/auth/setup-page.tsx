import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useCreatePerson, useSetup } from '@/features/auth/api'
import { AuthForm } from '@/features/auth/auth-form'
import { CredentialFields } from '@/features/auth/credential-fields'
import { fieldError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { Redirect } from '@/lib/router'

export function SetupPage() {
  const setup = useSetup()
  const createPerson = useCreatePerson()
  const code = new URLSearchParams(location.search).get('code') ?? ''
  if (setup.data?.open === false) return <Redirect to="/login" />
  return <AuthForm title="Create your account" heading="Create your account" lead="You're first here, so this is the owner account." error={createPerson.error}
    fields={code ? ['email', 'password'] : ['setupCode', 'email', 'password']} busy={createPerson.isPending} button="Create account" foot="After this, people join by invite."
    onSubmit={(event) => {
      const field = formValues(event)
      createPerson.mutate({ setupCode: field('setupCode'), email: field('email'), password: field('password') })
    }}>
    {code && <Input type="hidden" name="setupCode" value={code} />}
    {!code && <Field strong label="Setup code" error={fieldError(createPerson.error, 'setupCode')}>{(control) => <Input variant="lg" {...control} name="setupCode" required autoComplete="one-time-code" placeholder="Printed at the end of the install" />}</Field>}
    <CredentialFields error={createPerson.error} />
  </AuthForm>
}
