import { hash } from '@/lib/hash'

const PALETTE = [['#19B3B1', '#0e7f7e'], ['#F2E3C6', '#c9b48a'], ['#FF7A59', '#c4553a'], ['#ee8149', '#b36137'], ['#64ae59', '#4b8343'], ['#86c7b4', '#659587'], ['#3d8fdc', '#2e6ba5'], ['#e4587e', '#ab425f']]
const COSTUME_BY: [RegExp, Costume][] = [[/support|customer|inbox|reply|email/i, 'headset'], [/metric|report|posthog|numbers/i, 'glasses'], [/triage|alert|issue|incident/i, 'cap'], [/order|deliver|field|ops|warehouse/i, 'beanie']]
const COSTUMES = ['headset', 'glasses', 'cap', 'beanie', 'bow'] as const
const COSTUME_SVG: Record<Costume, string> = {
  cap: `<path d="M30 38q22-22 46 0z" fill="#2d4c9e" stroke="#0b0b0b" stroke-width="3" stroke-linejoin="round"/><path d="M60 38q16-2 22 4" stroke="#0b0b0b" stroke-width="3" fill="#2d4c9e"/><circle cx="53" cy="29" r="3" fill="#F7A439"/>`,
  headset: `<path d="M28 56q0-30 26-30t26 30" fill="none" stroke="#0b0b0b" stroke-width="4"/><rect x="23" y="52" width="9" height="13" rx="4" fill="#9AB7FF" stroke="#0b0b0b" stroke-width="2.5"/><rect x="76" y="52" width="9" height="13" rx="4" fill="#9AB7FF" stroke="#0b0b0b" stroke-width="2.5"/><path d="M28 64q2 12 16 12" fill="none" stroke="#0b0b0b" stroke-width="2.5"/>`,
  glasses: `<circle cx="45" cy="54" r="7" fill="none" stroke="#0b0b0b" stroke-width="2.6"/><circle cx="63" cy="54" r="7" fill="none" stroke="#0b0b0b" stroke-width="2.6"/><path d="M52 54h4" stroke="#0b0b0b" stroke-width="2.6"/>`,
  beanie: `<path d="M30 42q24-30 48 0z" fill="#FF7A59" stroke="#0b0b0b" stroke-width="3" stroke-linejoin="round"/><rect x="28" y="38" width="52" height="8" rx="4" fill="#F2E3C6" stroke="#0b0b0b" stroke-width="2.5"/><circle cx="54" cy="23" r="5" fill="#F2E3C6" stroke="#0b0b0b" stroke-width="2.5"/>`,
  bow: `<g transform="translate(-5 -2)"><path d="M66 36l-8 5 8 5zM74 36l8 5-8 5z" fill="#e4587e" stroke="#0b0b0b" stroke-width="2.5" stroke-linejoin="round"/><circle cx="70" cy="41" r="3" fill="#e4587e" stroke="#0b0b0b" stroke-width="2.5"/></g>`,
}

export function Avatar({ id, about = '', size, label }: { id: string; about?: string; size: number; label?: string }) {
  const accessible = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return <svg className="av" width={size} height={size} viewBox="4 8 100 100" {...accessible} dangerouslySetInnerHTML={{ __html: creature(id, about) }} />
}

function creature(id: string, about: string) {
  const random = randomFrom(id)
  const [fill, shade] = PALETTE[Math.floor((hash(id) % 360) / 45) % PALETTE.length]
  const ring: number[][] = []
  const blob: number[][] = []
  for (let i = 0; i < 14; i++) {
    const turn = i / 14 * Math.PI * 2, radius = 30 + (random() - .5) * 3
    ring.push([54 + Math.cos(turn) * radius, 68 + Math.sin(turn) * radius])
  }
  for (let i = 0; i < 10; i++) {
    const turn = i / 10 * Math.PI * 2, radius = 26 + (random() - .5) * 4
    blob.push([54 + Math.cos(turn) * radius * 1.05, 58 + Math.sin(turn) * radius * .97])
  }
  const sleepy = random() > .45, smile = random() > .5 ? 5 : 3
  const eyes = sleepy
    ? `<path d="M41 54q4-3 8 0M59 54q4-3 8 0" stroke="#0b0b0b" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<circle cx="45" cy="54" r="3.2" fill="#0b0b0b"/><circle cx="63" cy="54" r="3.2" fill="#0b0b0b"/>`
  const face = `<ellipse cx="40" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/><ellipse cx="68" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/>${eyes}<path d="M48 65q6 ${smile} 12 -1" stroke="#0b0b0b" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  return `<path d="${smooth(ring)}" fill="${shade}" opacity=".35"/><path d="${smooth(ring)}" fill="none" stroke="${fill}" stroke-width="3"/><path d="${smooth(blob)}" fill="${fill}" stroke="#0b0b0b" stroke-width="4.5" stroke-linejoin="round"/><path d="M42 76q12 7 24 0" stroke="${shade}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>${face}${COSTUME_SVG[costumeFor(id, about)]}`
}

function costumeFor(id: string, about: string) {
  return COSTUME_BY.find(([pattern]) => pattern.test(about))?.[1] ?? COSTUMES[hash(id + 'c') % COSTUMES.length]
}

function randomFrom(seed: string) {
  let state = hash(seed) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }
}

function smooth(points: number[][]) {
  const mid = (a: number[], b: number[]) => `${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`
  return 'M' + mid(points[points.length - 1], points[0]) + points.map((point, i) => ` Q${point[0].toFixed(1)} ${point[1].toFixed(1)} ${mid(point, points[(i + 1) % points.length])}`).join('') + 'Z'
}

type Costume = typeof COSTUMES[number]
