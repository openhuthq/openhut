import type { ReactNode } from 'react'
import type { BrandName } from '@/components/brand-icons'
import { Dialog } from '@/components/dialog'
import { ICONS, SETUP_ICONS, type SetupIcon } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'

export type SetupInfo = { brand: BrandName; title: string; blurb: string; chips: [SetupIcon, string][]; safe: string; warn?: string; eta: string; details?: string[] }

export function SetupDialog({ info, onClosed, children }: { info: SetupInfo; onClosed: () => void; children: (close: () => void) => ReactNode }) {
  return <Dialog labelledBy="setup-h" className="dlg setup" onClosed={onClosed}>{(close) => <div className="setupbox">
    <div className="setup-hd">
      <Mark name={info.brand} size={48} />
      <div className="t"><h2 id="setup-h">{info.title}</h2><p>{info.blurb}</p></div>
      <button type="button" className="btn ghost sm" onClick={close} aria-label="Close">{ICONS.x}</button>
    </div>
    <div className="setup-chips">{info.chips.map(([icon, label]) => <span className="setup-chip" key={label}>{SETUP_ICONS[icon]}{label}</span>)}</div>
    {children(close)}
  </div>}</Dialog>
}

export function SetupSteps({ children }: { children: ReactNode }) {
  return <div className="setup-bd">{children}</div>
}

export function SetupStep({ n, title, state = 'next', tag, children }: { n: number; title: string; state?: 'now' | 'done' | 'next'; tag?: ReactNode; children?: ReactNode }) {
  return <section className={`setup-st ${state}`}>
    <span className="setup-n" aria-hidden="true">{state === 'done' ? SETUP_ICONS.check : n}</span>
    <div className="setup-sb"><h3>{title}{tag && <span className={state === 'done' ? 'setup-tag ok' : 'setup-tag'}>{tag}</span>}</h3>{children}</div>
  </section>
}

export function SetupFoot({ info, error, cancel, children }: { info: SetupInfo; error?: string; cancel: () => void; children: ReactNode }) {
  return <>
    {info.warn && <div className="setup-line warn">{SETUP_ICONS.bolt}<span>{info.warn}</span></div>}
    <div className="setup-line">{SETUP_ICONS.shield}<span>{info.safe}</span>
      {info.details && <details className="setup-more"><summary>Details</summary><ul>{info.details.map((line) => <li key={line}>{line}</li>)}</ul></details>}
    </div>
    {error && <p className="setup-err" role="alert">{error}</p>}
    <div className="setup-ft">
      <span className="setup-eta">{SETUP_ICONS.clock}{info.eta}</span>
      <button type="button" className="btn sec" onClick={cancel}>Cancel</button>
      {children}
    </div>
  </>
}

export function SetupSubmit({ form = 'connect-main', brand, label, busy, pending, disabled = false, lock }: { form?: string; brand?: BrandName; label: string; busy: string; pending: boolean; disabled?: boolean; lock?: string }) {
  return <Locked reason={lock}><button form={form} className="btn primary setup-go" disabled={pending || disabled}>
    {brand && <span className="setup-go-mark"><Mark name={brand} size={18} /></span>}{pending ? busy : label}
  </button></Locked>
}

export function Choices({ name, options, value }: { name: string; options: [string, SetupIcon, string][]; value: string }) {
  return <div className="setup-seg" role="radiogroup">{options.map(([option, icon, label]) => <label key={option}>
    <input type="radio" name={name} value={option} defaultChecked={option === value} />{SETUP_ICONS[icon]}<span>{label}</span>
  </label>)}</div>
}
