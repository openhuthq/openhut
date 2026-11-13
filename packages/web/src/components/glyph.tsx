import { BRAND_ICONS, type BrandIcon, type BrandName } from '@/components/brand-icons'

export function Glyph({ name, size, onTile = false }: { name: BrandName; size: number; onTile?: boolean }) {
  const icon: BrandIcon = BRAND_ICONS[name]
  const viewBox = icon.vb ?? '0 0 24 24'
  if (icon.sprite) return <svg width={size} height={size} aria-hidden="true"><use href={`#${icon.sprite}`} width="100%" height="100%" /></svg>
  if (icon.path) return <svg width={size} height={size} viewBox={viewBox} aria-hidden="true"><path d={icon.path} style={{ fill: onTile && icon.tile ? '#fff' : icon.hex }} /></svg>
  return <svg width={size} height={size} viewBox={viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon.svg ?? '' }} />
}
