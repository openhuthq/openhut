import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function FieldSet({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('flex flex-col gap-1.5', className)} {...props} />
}

export function FieldLabel({ className, strong = false, ...props }: ComponentProps<'label'> & { strong?: boolean }) {
  return <label className={cn(strong && 'text-sm font-medium', className)} {...props} />
}

export function FieldTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-sm font-medium', className)} {...props} />
}

export function FieldDescription({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('text-xs text-mute', className)} {...props} />
}

export function FieldError({ className, ...props }: ComponentProps<'span'>) {
  return <span role="alert" className={cn('text-xs text-fail', className)} {...props} />
}

export function Field({ label, hint, error, strong, className, children }: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  strong?: boolean
  className?: string
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}) {
  const id = useId()
  const noteId = `${id}-note`
  const described = error || hint ? noteId : undefined
  return <FieldSet className={className}>
    <FieldLabel htmlFor={id} strong={strong}>{label}</FieldLabel>
    {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
    {error && <FieldError id={noteId}>{error}</FieldError>}
    {!error && hint && <FieldDescription id={noteId}>{hint}</FieldDescription>}
  </FieldSet>
}
