import { Wrench01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Glyph } from '@/components/glyph'
import type { BrandName } from '@/components/brand-icons'
import { I } from '@/components/kit'
import { cn } from '@/lib/utils'

export function AppIcon({ brand, size, fallback = Wrench01Icon }: { brand: BrandName | undefined; size: 18 | 28; fallback?: IconSvgElement }) {
  if (brand && brand !== 'mcp') return <Glyph name={brand} size={size} />
  return <span className={cn('grid shrink-0 place-items-center rounded-lg bg-soft text-mute', size === 28 ? 'size-7' : 'size-[18px] rounded-md')}><I icon={fallback} size={size === 28 ? 16 : 12} /></span>
}
