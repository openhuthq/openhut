import { Field } from '@/components/field'
import { fieldError } from '@/lib/api-client'

export function CredentialFields({ error }: { error: Error | null }) {
  return <>
    <Field label="Email" error={fieldError(error, 'email')}>{(control) => <input {...control} name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@company.com" />}</Field>
    <Field label="Password" error={fieldError(error, 'password')}>{(control) => <input {...control} name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="12+ characters" />}</Field>
  </>
}
