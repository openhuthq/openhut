import { createContext, use, useEffect, useState, useSyncExternalStore, type ComponentProps, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { ICONS } from '@/components/icons'
import { cn } from '@/lib/utils'

const MOBILE_QUERY = '(max-width: 900px)'
const COOKIE = 'sidebar_state'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const SHORTCUT = 'b'

type SidebarState = {
  isMobile: boolean
  open: boolean
  openMobile: boolean
  setOpenMobile: Dispatch<SetStateAction<boolean>>
  toggle: () => void
}

const SidebarContext = createContext<SidebarState>({ isMobile: false, open: true, openMobile: false, setOpenMobile: () => {}, toggle: () => {} })

export function useSidebar() {
  return use(SidebarContext)
}

export function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => matchMedia(MOBILE_QUERY).matches)
}

function subscribeMobile(listener: () => void) {
  const query = matchMedia(MOBILE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(() => !document.cookie.includes(`${COOKIE}=false`))
  const [openMobile, setOpenMobile] = useState(false)
  const toggle = () => isMobile ? setOpenMobile((value) => !value) : setOpen((value) => !value)
  useEffect(() => { document.cookie = `${COOKIE}=${open}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax` }, [open])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SHORTCUT || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const docked = open && !isMobile
  return <SidebarContext value={{ isMobile, open, openMobile, setOpenMobile, toggle }}>
    <div data-state={docked ? 'expanded' : 'collapsed'} className={cn('group/app grid h-dvh overflow-hidden bg-sidebar transition-[grid-template-columns] duration-200 ease-linear', docked ? 'grid-cols-[232px_minmax(0,1fr)]' : 'grid-cols-[0px_minmax(0,1fr)]')}>{children}</div>
  </SidebarContext>
}

const ASIDE = 'flex h-full min-w-0 flex-col gap-0.5 overflow-hidden p-2'

export function Sidebar({ className, ...props }: ComponentProps<'aside'>) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  if (!isMobile) return <aside className={cn(ASIDE, 'w-[232px] transition-[visibility] duration-200 group-data-[state=collapsed]/app:invisible', className)} {...props} />
  return <DialogPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[oklch(0%_0_0/.32)] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 w-[min(288px,85vw)] bg-sidebar shadow-sheet outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full" onClick={(event) => { if (event.target instanceof Element && event.target.closest('a[href]')) setOpenMobile(false) }}>
        <aside className={cn(ASIDE, className)} {...props} />
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('group/team flex h-12 shrink-0 items-center gap-2.5 px-2', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-auto flex flex-col gap-0.5', className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-2 pt-3.5 pb-1 text-xs text-mute', className)} {...props} />
}

export function SidebarMenuButton({ className, ...props }: ComponentProps<'a'>) {
  return <a className={cn('flex h-[30px] w-full shrink-0 items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-sm font-medium text-ink no-underline hover:bg-tint aria-[current=page]:bg-soft mobile:h-9 [&_svg]:shrink-0', className)} {...props} />
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('ml-auto font-mono text-xs text-mute', className)} {...props} />
}

export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return <main className={cn('col-start-2 m-2 ml-0 flex min-w-0 flex-col overflow-hidden rounded-xl border border-hair bg-canvas transition-[margin] duration-200 ease-linear group-data-[state=collapsed]/app:ml-2 mobile:m-0! mobile:rounded-none mobile:border-0', className)} {...props} />
}

export function SidebarTrigger() {
  const { toggle } = useSidebar()
  return <Button type="button" size="icon-sm" aria-label="Toggle sidebar" title="Toggle sidebar (⌘B)" onClick={toggle}>{ICONS.side}</Button>
}
