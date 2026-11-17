import type { ComponentProps } from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={cn('relative inline-block h-[18px] w-8 shrink-0 cursor-pointer rounded-full border-0 bg-mid p-0 align-middle data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50', className)} {...props}>
    <SwitchPrimitive.Thumb className="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white [transition:translate_.15s] data-checked:translate-x-3.5" />
  </SwitchPrimitive.Root>
}
