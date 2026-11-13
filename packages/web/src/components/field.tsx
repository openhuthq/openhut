import { useId, type ReactNode } from 'react'

export function Field({ label, hint, error, className = 'f', children }: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  className?: string
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}) {
  const id = useId()
  const noteId = `${id}-note`
  const described = error || hint ? noteId : undefined
  return <div className={className}>
    <label htmlFor={id}>{label}</label>
    {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
    {error && <span id={noteId} className="ferr" role="alert">{error}</span>}
    {!error && hint && <span id={noteId} className="hint">{hint}</span>}
  </div>
}
