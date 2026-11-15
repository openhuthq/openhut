import { Field } from '@/components/field'
import { useCreateSession } from '@/features/auth/api'
import { AuthForm } from '@/features/auth/auth-form'
import { fieldError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const FIELDS = ['email', 'password']

export function SignInPage() {
  const createSession = useCreateSession()
  return <AuthForm title="Sign in" heading="Welcome back" lead="Sign in to OpenHut." error={createSession.error} fields={FIELDS} busy={createSession.isPending}
    button="Sign in" foot="No account? Ask an owner or admin for an invite link."
    onSubmit={(event) => {
      const field = formValues(event)
      createSession.mutate({ email: field('email'), password: field('password') })
    }}>
    <Field label="Email" error={fieldError(createSession.error, 'email')}>{(control) => <input {...control} name="email" type="email" required autoComplete="email" />}</Field>
    <Field label="Password" error={fieldError(createSession.error, 'password')}>{(control) => <input {...control} name="password" type="password" required autoComplete="current-password" />}</Field>
  </AuthForm>
}
