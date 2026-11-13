import type { ReactNode } from 'react'

export function DialogFoot({ error, children }: { error?: string; children: ReactNode }) {
  return <div className="dlgfoot">
    {error ? <p className="err" role="alert">{error}</p> : <span></span>}
    <div className="dlgacts">{children}</div>
  </div>
}
