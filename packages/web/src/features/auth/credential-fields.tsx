import { useState } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const MIN_LENGTH = 12
const LONG = 16
const VERY_LONG = 20
const KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
const TONE = ['bg-mid', 'bg-fail', 'bg-[oklch(75%_.16_70)]', 'bg-[oklch(70%_.17_125)]', 'bg-pass']
const LABELS = ['Use 12 or more characters.', '', 'Okay. Longer is stronger.', 'Good.', 'Strong.']

export function CredentialFields({ error }: { error: Error | null }) {
  const [password, setPassword] = useState('')
  const score = strength(password)
  const missing = MIN_LENGTH - password.length
  return <>
    <Field strong label="Email" error={fieldError(error, 'email')}>{(control) => <Input variant="lg" {...control} name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@company.com" />}</Field>
    <Field strong label="Password" error={fieldError(error, 'password')}>{(control) => <>
      <Input variant="lg" {...control} name="password" type="password" required autoComplete="new-password" placeholder="12+ characters" onInput={(event) => setPassword(event.currentTarget.value)} />
      <div className="mt-2 flex flex-col gap-1.5 font-copy text-xs text-mute" role="status">
        <div className="grid grid-cols-4 gap-1" aria-hidden="true">{[1, 2, 3, 4].map((bar) => <i key={bar} className={cn('h-1 rounded-full [transition:background_.25s]', bar <= score ? TONE[score] : 'bg-soft')}></i>)}</div>
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
