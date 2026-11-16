import type { ReactNode } from 'react'
import { BRAND_ICONS, type BrandIcon, type BrandName } from '@/components/brand-icons'
import { Glyph } from '@/components/glyph'
import { cn } from '@/lib/utils'

type Kind = 'plain' | 'filled' | 'full'
export type MarkVariant = 'default' | 'outline' | 'kind' | 'setup' | 'bare' | 'connected'

const EDGE = 'shadow-[inset_0_0_0_.5px_oklch(0%_0_0/.11)]'
const QUIET = `bg-[oklch(0%_0_0/.05)] ${EDGE}`
const RING = 'shadow-[inset_0_0_0_1px_var(--hair)]'
const LOOK: Record<MarkVariant, Record<Kind, string>> = {
  default: { plain: `rounded-lg ${QUIET}`, filled: 'rounded-lg', full: 'rounded-lg' },
  outline: { plain: `rounded-lg bg-card ${RING}`, filled: 'rounded-lg', full: `rounded-lg bg-card ${RING}` },
  kind: { plain: `rounded-lg bg-card ${RING}`, filled: `rounded-lg ${RING}`, full: `rounded-lg bg-card ${RING}` },
  setup: { plain: `rounded-xl bg-canvas ${RING}`, filled: 'rounded-xl', full: 'rounded-xl bg-canvas' },
  bare: { plain: 'rounded-lg', filled: 'rounded-lg', full: 'rounded-lg' },
  connected: { plain: `rounded-xl bg-white ${EDGE}`, filled: 'rounded-xl', full: 'rounded-xl bg-white' },
}
const TILE = 'grid shrink-0 place-items-center border-0'

function kindOf(icon: BrandIcon): Kind {
  if (icon.full) return 'full'
  return icon.tile ? 'filled' : 'plain'
}

export function Mark({ name, size = 28, variant = 'default', className }: { name: BrandName; size?: number; variant?: MarkVariant; className?: string }) {
  const icon: BrandIcon = BRAND_ICONS[name]
  const kind = kindOf(icon)
  const look = cn(TILE, LOOK[variant][kind], kind === 'full' && 'overflow-hidden [&_svg]:block', className)
  if (kind === 'full') return <span className={look} style={{ width: size, height: size }}><Glyph name={name} size={size} /></span>
  return <span className={look} style={{ width: size, height: size, background: icon.tile }}><Glyph name={name} size={Math.round(size / 2)} onTile /></span>
}

export function Tile({ tone = 'quiet', className, children }: { tone?: 'quiet' | 'ink'; className?: string; children: ReactNode }) {
  return <span className={cn(TILE, 'rounded-lg', tone === 'ink' ? 'bg-ink text-white' : QUIET, className)}>{children}</span>
}
