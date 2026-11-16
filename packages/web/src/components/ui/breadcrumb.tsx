import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Breadcrumb({ className, ...props }: ComponentProps<'nav'>) {
  return <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-1.5 text-sm', className)} {...props} />
}

export function BreadcrumbLink({ className, ...props }: ComponentProps<'a'>) {
  return <a className={cn('text-mute no-underline mobile:hidden', className)} {...props} />
}

export function BreadcrumbSeparator({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-hidden="true" className={cn('text-mute mobile:hidden', className)} {...props}>/</span>
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 className={cn('m-0 truncate text-sm font-normal', className)} {...props} />
}
