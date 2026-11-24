import type { ReactElement } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

export function Tooltip({ label, children }: { label: string; children: ReactElement<Record<string, unknown>> }) {
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger delay={300} render={children} />
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner className="z-50" side="bottom" sideOffset={6}>
        <TooltipPrimitive.Popup className="rounded-md bg-ink px-2 py-1 text-[12px] text-white shadow-menu">{label}</TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
}
