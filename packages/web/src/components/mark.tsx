import { BRAND_ICONS, type BrandIcon, type BrandName } from '@/components/brand-icons'
import { Glyph } from '@/components/glyph'

export function Mark({ name, size = 28 }: { name: BrandName; size?: number }) {
  const icon: BrandIcon = BRAND_ICONS[name]
  if (icon.full) return <span className="mark full" style={{ width: size, height: size }}><Glyph name={name} size={size} /></span>
  return <span className={icon.tile ? 'mark filled' : 'mark'} style={{ width: size, height: size, background: icon.tile }}><Glyph name={name} size={Math.round(size / 2)} onTile /></span>
}
