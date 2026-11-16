import type { ComponentProps } from 'react'
import { inputVariants } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn(inputVariants({ variant: 'chip' }), className)} {...props} />
}
