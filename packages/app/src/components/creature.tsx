import { FULL_VIEW, SWATCHES, bgColor, faceArt, randomLook, type Look } from '@/lib/face'
import { cn } from '@/lib/utils'

export function Creature({ look, id = '', about = '', size, label, tile, className }: { look?: Look; id?: string; about?: string; size: number; label?: string; tile?: boolean; className?: string }) {
  const accessible = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return <svg data-slot="creature" className={cn('block shrink-0', className)} width={size} height={size} viewBox={FULL_VIEW} ref={centerArt} {...accessible} dangerouslySetInnerHTML={{ __html: faceArt({ look: look ?? randomLook({ seed: id, about }), tile }) }} />
}

function centerArt(svg: SVGSVGElement | null) {
  if (!svg) return
  svg.setAttribute('viewBox', FULL_VIEW)
  const art = svg.getBBox()
  if (art.height > 0) svg.setAttribute('viewBox', `4 ${art.y + art.height / 2 - 50} 100 100`)
}

export async function avatarPng(look: Look, size = 1024): Promise<string> {
  const ground = `<rect x="-6" y="-2" width="120" height="120" fill="${bgColor(look.bg) ?? bgColor(SWATCHES[look.body].id)}"/>`
  const image = new Image()
  image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-6 -2 120 120">${ground}${faceArt({ look })}</svg>`)}`
  await image.decode()
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  canvas.getContext('2d')?.drawImage(image, 0, 0, size, size)
  return canvas.toDataURL('image/png').split(',')[1]
}
