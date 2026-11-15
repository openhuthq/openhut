import type { ReactNode } from 'react'

export function DialogFoot({ error, start, children }: { error?: string; start?: ReactNode; children: ReactNode }) {
  return <div className="dlgfoot">
    {error ? <p className="err" role="alert">{error}</p> : <span>{start}</span>}
    <div className="dlgacts">{children}</div>
  </div>
}
