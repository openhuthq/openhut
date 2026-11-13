import { Field } from '@/components/field'
import { useCreateSession } from '@/features/auth/api'
import { AuthForm } from '@/features/auth/auth-form'
import { fieldError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const FIELDS = ['username', 'password']

export function SignInPage() {
  const createSession = useCreateSession()
  return <AuthForm title="Sign in" heading="Welcome back" lead="Sign in to JakeBox." error={createSession.error} fields={FIELDS} busy={createSession.isPending}
    button="Sign in" foot="No account? Ask an owner or admin for an invite link."
    onSubmit={(event) => {
      const field = formValues(event)
      createSession.mutate({ username: field('username'), password: field('password') })
    }}>
    <Field label="Username" error={fieldError(createSession.error, 'username')}>{(control) => <input {...control} name="username" required autoComplete="username" />}</Field>
    <Field label="Password" error={fieldError(createSession.error, 'password')}>{(control) => <input {...control} name="password" type="password" required autoComplete="current-password" />}</Field>
  </AuthForm>
}
