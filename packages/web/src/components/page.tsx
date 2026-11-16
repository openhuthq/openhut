import { Fragment, type ReactNode } from 'react'
import { Breadcrumb, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const ACTIONS = 'ml-auto flex items-center gap-2 phone:[&_:has(>[data-label])]:w-8 phone:[&_:has(>[data-label])]:justify-center phone:[&_:has(>[data-label])]:px-0 phone:[&_[data-label]]:sr-only'

export function Page({ title, parents = [], actions, fill = false, hero = false, children }: { title: string; parents?: { label: string; href: string }[]; actions?: ReactNode; fill?: boolean; hero?: boolean; children?: ReactNode }) {
  return <>
    <title>{`${title} · OpenHut`}</title>
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-hair pr-3 pl-4">
      <SidebarTrigger /><Separator orientation="vertical" />
      <Breadcrumb>
        {parents.map((parent) => <Fragment key={parent.href}><BreadcrumbLink href={parent.href}>{parent.label}</BreadcrumbLink><BreadcrumbSeparator /></Fragment>)}
        <BreadcrumbPage>{title}</BreadcrumbPage>
      </Breadcrumb>
      <div className={ACTIONS}>{actions}</div>
    </div>
    <div className={fill ? 'flex min-h-0 flex-1 flex-col bg-card' : cn('flex-1 overflow-auto px-6 pt-4 pb-8 mobile:p-4', hero && 'pt-2.5 mobile:pt-2.5')}>{children}</div>
  </>
}

export function ButtonLabel({ children }: { children: ReactNode }) {
  return <span data-label>{children}</span>
}
