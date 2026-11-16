import { createContext, use, useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ICONS } from '@/components/icons'
import { cn } from '@/lib/utils'

const SidebarContext = createContext({ collapsed: false, toggle: () => {} })

export function useSidebar() {
  return use(SidebarContext)
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return <SidebarContext value={{ collapsed, toggle: () => setCollapsed(!collapsed) }}>
    <div data-collapsed={collapsed || undefined} className={cn('group/app grid h-dvh overflow-hidden bg-sidebar mobile:h-auto mobile:min-h-screen mobile:grid-cols-1', collapsed ? 'grid-cols-[1fr]' : 'grid-cols-[232px_minmax(0,1fr)]')}>{children}</div>
  </SidebarContext>
}

export function Sidebar({ className, ...props }: ComponentProps<'aside'>) {
  return <aside className={cn('flex min-w-0 flex-col gap-0.5 overflow-hidden p-2 group-data-collapsed/app:hidden mobile:flex-row mobile:flex-wrap mobile:items-center mobile:border-b mobile:border-hair', className)} {...props} />
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('group/team flex h-12 items-center gap-2.5 px-2 mobile:hidden', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-auto flex flex-col gap-0.5 mobile:m-0 mobile:flex-row', className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-2 pt-3.5 pb-1 text-xs text-mute', className)} {...props} />
}

export function SidebarMenuButton({ className, ...props }: ComponentProps<'a'>) {
  return <a className={cn('flex h-[30px] w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-sm font-medium text-ink no-underline hover:bg-tint aria-[current=page]:bg-soft mobile:w-auto [&_svg]:shrink-0', className)} {...props} />
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('ml-auto font-mono text-xs text-mute', className)} {...props} />
}

export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return <main className={cn('m-2 ml-0 flex min-w-0 flex-col overflow-hidden rounded-xl border border-hair bg-canvas group-data-collapsed/app:ml-2 mobile:m-0 mobile:min-h-[680px] mobile:rounded-none mobile:border-0 mobile:group-data-collapsed/app:m-2', className)} {...props} />
}

export function SidebarTrigger() {
  const { toggle } = useSidebar()
  return <Button type="button" size="icon-sm" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={toggle}>{ICONS.side}</Button>
}
