import type { FormEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Hut } from '@/components/hut'
import { formError } from '@/lib/api-client'

export const BIG = 'h-11 w-full justify-center gap-2 rounded-[10px] text-[15px]'

export function AuthForm({ title, line, error, fields, busy, button, foot, onSubmit, children }: {
  title: string
  line: string
  error: Error | null
  fields: readonly string[]
  busy: boolean
  button: string
  foot?: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return <EntryScreen title={title} line={line} foot={foot}>
    <form className="flex w-full flex-col gap-4 text-left" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(event) }}>
      <ErrorNote message={formError(error, fields)} />
      {children}
      <Button type="submit" variant="primary" className={BIG} disabled={busy}>{busy ? `${button}…` : button}</Button>
    </form>
  </EntryScreen>
}

export function EntryScreen({ title, line, foot, children }: { title: string; line?: ReactNode; foot?: ReactNode; children?: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center text-ink">
    <title>{`${title} · OpenHut`}</title>
    <div className="h-[52px] shrink-0" />
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-6">
      <div className="flex w-[360px] max-w-full flex-col items-center">
        <span className="relative isolate mb-7 size-[88px] shrink-0 phone:size-20">
          <Hut className="still size-full" />
        </span>
        <h1 className="m-0 text-[30px]/[36px] font-bold tracking-[-.03em] text-balance phone:text-[28px]/[34px]">{title}</h1>
        {line && <p className="m-0 mt-2 max-w-[320px] text-[15px]/[22px] text-balance text-body">{line}</p>}
        <div className="mt-8 flex w-full flex-col items-center gap-3 text-[13px]/[18px] empty:hidden">{children}</div>
      </div>
    </div>
    {foot && <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-[22px] gap-y-1 px-6 pt-[18px] pb-7 text-[13px] text-mute">{foot}</div>}
  </div>
}
