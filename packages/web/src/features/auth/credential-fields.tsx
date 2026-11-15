import { useState } from 'react'
import { Field } from '@/components/field'
import { fieldError } from '@/lib/api-client'

const MIN_LENGTH = 12
const LONG = 16
const VERY_LONG = 20
const KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
const LABELS = ['Use 12 or more characters.', '', 'Okay. Longer is stronger.', 'Good.', 'Strong.']

export function CredentialFields({ error }: { error: Error | null }) {
  const [password, setPassword] = useState('')
  const score = strength(password)
  const missing = MIN_LENGTH - password.length
  return <>
    <Field label="Email" error={fieldError(error, 'email')}>{(control) => <input {...control} name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@company.com" />}</Field>
    <Field label="Password" error={fieldError(error, 'password')}>{(control) => <>
      <input {...control} name="password" type="password" required autoComplete="new-password" placeholder="12+ characters" onInput={(event) => setPassword(event.currentTarget.value)} />
      <div className="strength" data-score={score} role="status">
        <div className="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <span>{score === 1 ? `${missing} more ${missing === 1 ? 'character' : 'characters'} to go.` : LABELS[score]}</span>
      </div>
    </>}</Field>
  </>
}

function strength(password: string): number {
  if (!password) return 0
  if (password.length < MIN_LENGTH) return 1
  const varied = KINDS.filter((kind) => kind.test(password)).length >= 3
  const bonus = Number(password.length >= LONG) + Number(varied) + Number(password.length >= VERY_LONG)
  return Math.min(4, 2 + bonus)
}
