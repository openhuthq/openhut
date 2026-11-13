import type { FormEvent, ReactNode } from 'react'
import { AuthLayout } from '@/features/auth/auth-layout'
import { formError } from '@/lib/api-client'

export function AuthForm({ title, heading, lead, error, fields, busy, button, foot, onSubmit, children }: {
  title: string
  heading: string
  lead: string
  error: Error | null
  fields: readonly string[]
  busy: boolean
  button: string
  foot: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  const message = formError(error, fields)
  return <AuthLayout title={title}>
    <form className="authform" noValidate onSubmit={onSubmit}>
      <div><h1>{heading}</h1><p className="lead">{lead}</p></div>
      {message && <p className="err" role="alert">{message}</p>}
      {children}
      <button className="btn primary" disabled={busy}>{button}</button>
      <p className="authfoot">{foot}</p>
    </form>
  </AuthLayout>
}
