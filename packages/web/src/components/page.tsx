import { createContext, Fragment, use, type ReactNode } from 'react'
import { ICONS } from '@/components/icons'

export const SidebarToggle = createContext(() => {})

export function Page({ title, parents = [], actions, fill = false, children }: { title: string; parents?: { label: string; href: string }[]; actions?: ReactNode; fill?: boolean; children?: ReactNode }) {
  const toggleSidebar = use(SidebarToggle)
  return <>
    <title>{`${title} · OpenHut`}</title>
    <div className="ph">
      <button type="button" className="btn icon sm" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={toggleSidebar}>{ICONS.side}</button><span className="vsep"></span>
      <nav className="crumb" aria-label="Breadcrumb">
        {parents.map((parent) => <Fragment key={parent.href}><a href={parent.href}>{parent.label}</a><span className="mute" aria-hidden="true">/</span></Fragment>)}
        <h1 className="ellip">{title}</h1>
      </nav>
      <div className="actions">{actions}</div>
    </div>
    <div className={fill ? 'pfill' : 'pb'}>{children}</div>
  </>
}
