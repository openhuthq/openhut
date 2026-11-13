import { Field } from '@/components/field'
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
    fields={code ? ['username', 'password'] : ['setupCode', 'username', 'password']} busy={createPerson.isPending} button="Create account" foot="After this, people join by invite."
    onSubmit={(event) => {
      const field = formValues(event)
      createPerson.mutate({ setupCode: field('setupCode'), username: field('username'), password: field('password') })
    }}>
    {code && <input type="hidden" name="setupCode" value={code} />}
    {!code && <Field label="Setup code" error={fieldError(createPerson.error, 'setupCode')}>{(control) => <input {...control} name="setupCode" required autoComplete="one-time-code" placeholder="Printed at the end of the install" />}</Field>}
    <CredentialFields error={createPerson.error} />
  </AuthForm>
}
