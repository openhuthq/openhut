import type { ReactNode } from 'react'
import { ICONS } from '@/components/icons'

export function DialogHead({ id, title, subtitle, onClose }: { id: string; title: string; subtitle?: ReactNode; onClose?: () => void }) {
  return <div className="dlghead">
    <div className="dlgtitle"><h2 id={id}>{title}</h2>{subtitle && <p className="mute">{subtitle}</p>}</div>
    {onClose && <button type="button" className="btn icon sm" onClick={onClose} aria-label="Close" title="Close">{ICONS.x}</button>}
  </div>
}
