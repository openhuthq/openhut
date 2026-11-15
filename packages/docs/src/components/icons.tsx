export function PageIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const src = icon.startsWith('logo:') ? `/docs/logos/${icon.slice(5)}.svg` : `/docs/mascots/${icon}.svg`
  return <img src={src} alt="" className="pico" width={size} height={size} />
}
