import { Field } from '@/components/field'
import { fieldError } from '@/lib/api-client'

export function CredentialFields({ error }: { error: Error | null }) {
  return <>
    <Field label="Username" error={fieldError(error, 'username')}>{(control) => <input {...control} name="username" required autoComplete="username" pattern="[a-z0-9._\-]{2,32}" title="2 to 32 lowercase letters, digits, dots, dashes or underscores" placeholder="mo" />}</Field>
    <Field label="Password" error={fieldError(error, 'password')}>{(control) => <input {...control} name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="12+ characters" />}</Field>
  </>
}
