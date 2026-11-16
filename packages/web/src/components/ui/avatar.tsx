import type { ComponentProps } from 'react'
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@/lib/utils'

export function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={cn('grid shrink-0 place-items-center rounded-full text-[12px] font-medium text-white', className)} {...props} />
}

export const AvatarFallback = AvatarPrimitive.Fallback
