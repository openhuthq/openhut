import type { FormEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
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
    <form className={PANEL} noValidate onSubmit={onSubmit}>
      <AuthHeading heading={heading} lead={lead} />
      <ErrorNote message={message} />
      {children}
      <Button type="submit" variant="primary" size="lg" disabled={busy}>{button}</Button>
      <p className="m-0 font-copy text-xs text-mute">{foot}</p>
    </form>
  </AuthLayout>
}

const PANEL = 'm-auto flex w-full max-w-[380px] flex-col gap-[18px] py-12'

export function AuthPanel({ children }: { children: ReactNode }) {
  return <div className={PANEL}>{children}</div>
}

export function AuthHeading({ heading, lead }: { heading: string; lead: string }) {
  return <div><h1 className="m-0 font-display text-[56px]/[.92] font-normal text-balance uppercase">{heading}</h1><p className="mt-3 mb-0 font-copy text-sm/[1.55] text-mute">{lead}</p></div>
}
