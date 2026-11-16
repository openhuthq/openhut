import { hash } from '@/lib/hash'

const K = '#0b0b0b'
const PALETTE = [['#19B3B1', '#0e7f7e'], ['#F2E3C6', '#c9b48a'], ['#FF7A59', '#c4553a'], ['#ee8149', '#b36137'], ['#64ae59', '#4b8343'], ['#86c7b4', '#659587'], ['#3d8fdc', '#2e6ba5'], ['#e4587e', '#ab425f'], ['#f7c948', '#c49a2c'], ['#b79cf2', '#8a72c4'], ['#9ab7ff', '#6f8bd1'], ['#f4a6c0', '#c97d97']]
const COSTUME = {
  cap: `<path d="M30 38q22-22 46 0z" fill="#2d4c9e" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M60 38q16-2 22 4" stroke="${K}" stroke-width="3" fill="#2d4c9e"/><circle cx="53" cy="29" r="3" fill="#F7A439"/>`,
  headset: `<path d="M28 56q0-30 26-30t26 30" fill="none" stroke="${K}" stroke-width="4"/><rect x="23" y="52" width="9" height="13" rx="4" fill="#9AB7FF" stroke="${K}" stroke-width="2.5"/><rect x="76" y="52" width="9" height="13" rx="4" fill="#9AB7FF" stroke="${K}" stroke-width="2.5"/><path d="M28 64q2 12 16 12" fill="none" stroke="${K}" stroke-width="2.5"/>`,
  glasses: `<circle cx="45" cy="54" r="7" fill="#fff" fill-opacity=".35" stroke="${K}" stroke-width="2.6"/><circle cx="63" cy="54" r="7" fill="#fff" fill-opacity=".35" stroke="${K}" stroke-width="2.6"/><path d="M52 54h4" stroke="${K}" stroke-width="2.6"/>`,
  beanie: `<path d="M30 42q24-30 48 0z" fill="#FF7A59" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><rect x="28" y="38" width="52" height="8" rx="4" fill="#F2E3C6" stroke="${K}" stroke-width="2.5"/><circle cx="54" cy="23" r="5" fill="#F2E3C6" stroke="${K}" stroke-width="2.5"/>`,
  bow: `<g transform="translate(-5 -2)"><path d="M66 36l-8 5 8 5zM74 36l8 5-8 5z" fill="#e4587e" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="70" cy="41" r="3" fill="#e4587e" stroke="${K}" stroke-width="2.5"/></g>`,
  crown: `<path d="M38 37l-2-16 10 8 8-13 8 13 10-8-2 16z" fill="#f7c948" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><circle cx="54" cy="30" r="2.2" fill="#e4587e"/>`,
  antenna: `<path d="M54 33V19" stroke="${K}" stroke-width="3" stroke-linecap="round"/><circle cx="54" cy="16" r="5" fill="#FF7A59" stroke="${K}" stroke-width="2.5"/>`,
  party: `<path d="M41 37l14-25 11 22z" fill="#9ab7ff" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M47 27l12 5M51 20l9 4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="55" cy="11" r="4" fill="#f7c948" stroke="${K}" stroke-width="2.5"/>`,
  tophat: `<rect x="42" y="13" width="24" height="22" rx="2.5" fill="#26262b" stroke="${K}" stroke-width="3"/><rect x="42" y="27" width="24" height="4.5" fill="#e4587e"/><rect x="33" y="33" width="42" height="6.5" rx="3.2" fill="#26262b" stroke="${K}" stroke-width="3"/>`,
  flower: `<g transform="translate(73 37)" stroke="${K}" stroke-width="2"><circle cy="-6" r="4.2" fill="#fff"/><circle cx="5.7" cy="-1.9" r="4.2" fill="#fff"/><circle cx="3.5" cy="4.9" r="4.2" fill="#fff"/><circle cx="-3.5" cy="4.9" r="4.2" fill="#fff"/><circle cx="-5.7" cy="-1.9" r="4.2" fill="#fff"/><circle r="3.6" fill="#f7c948"/></g>`,
  sprout: `<path d="M54 34v-9" stroke="${K}" stroke-width="3" stroke-linecap="round"/><path d="M54 26q-11-1-13-11 10-1 13 11zM54 26q11-1 13-11-10-1-13 11z" fill="#64ae59" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/>`,
  halo: `<ellipse cx="54" cy="23" rx="16" ry="5" fill="none" stroke="${K}" stroke-width="6.5"/><ellipse cx="54" cy="23" rx="16" ry="5" fill="none" stroke="#f7c948" stroke-width="3"/>`,
  monocle: `<circle cx="63" cy="54" r="8" fill="#fff" fill-opacity=".35" stroke="${K}" stroke-width="2.6"/><path d="M70 59q5 9 1 19" fill="none" stroke="${K}" stroke-width="2" stroke-linecap="round"/>`,
  shades: `<rect x="36" y="48" width="16" height="11" rx="4.5" fill="${K}"/><rect x="56" y="48" width="16" height="11" rx="4.5" fill="${K}"/><path d="M52 52h4M36 52l-6-3M72 52l6-3" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/><path d="M40 52h5M60 52h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`,
}
const COSTUMES = Object.keys(COSTUME) as Costume[]
const ON_FACE: Costume[] = ['glasses', 'monocle', 'shades']
const COSTUME_BY: [RegExp, Costume][] = [[/support|customer|inbox|reply|email/i, 'headset'], [/metric|report|posthog|numbers|analy/i, 'glasses'], [/triage|alert|issue|incident/i, 'cap'], [/order|deliver|field|ops|warehouse/i, 'beanie'], [/invoice|finance|money|pay/i, 'tophat'], [/sales|lead|deal/i, 'shades'], [/hir|recruit|people/i, 'bow']]
const EYES = [
  `<circle cx="45" cy="54" r="3.2" fill="${K}"/><circle cx="63" cy="54" r="3.2" fill="${K}"/>`,
  `<path d="M41 54q4-3 8 0M59 54q4-3 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  `<path d="M41 56q4-6 8 0M59 56q4-6 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  `<circle cx="45" cy="54" r="3.2" fill="${K}"/><path d="M59 55q4-5 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  `<circle cx="45" cy="54" r="4.2" fill="${K}"/><circle cx="63" cy="54" r="4.2" fill="${K}"/><circle cx="46.5" cy="52.5" r="1.4" fill="#fff"/><circle cx="64.5" cy="52.5" r="1.4" fill="#fff"/>`,
]

export function Avatar({ id, about = '', size, label }: { id: string; about?: string; size: number; label?: string }) {
  const accessible = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return <svg className="av" width={size} height={size} viewBox="4 8 100 100" {...accessible} dangerouslySetInnerHTML={{ __html: creature(id, about) }} />
}

export async function avatarPng({ id, about = '' }: { id: string; about?: string }): Promise<string> {
  const [fill] = PALETTE[hash(id) % PALETTE.length]
  const ground = `<rect x="-6" y="-2" width="120" height="120" fill="#fff"/><rect x="-6" y="-2" width="120" height="120" fill="${fill}" opacity=".22"/>`
  const image = new Image()
  image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-6 -2 120 120">${ground}${creature(id, about)}</svg>`)}`
  await image.decode()
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 1024 })
  canvas.getContext('2d')?.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png').split(',')[1]
}

function creature(id: string, about: string) {
  const random = randomFrom(id)
  const [fill, shade] = PALETTE[hash(id) % PALETTE.length]
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
  const eyes = EYES[Math.floor(random() * EYES.length)]
  const shape = random()
  const mouth = shape > .72
    ? `<path d="M49 64q5 8 10 0z" fill="${K}" stroke="${K}" stroke-width="2" stroke-linejoin="round"/>`
    : `<path d="M48 65q6 ${shape > .35 ? 5 : 3} 12 -1" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  const costume = costumeFor(id, about)
  const onFace = ON_FACE.includes(costume)
  const blink = `animation-delay:-${(hash(id + 'b') % 48) / 10}s`
  return `<g class="c-body"><path d="${smooth(blob)}" fill="${fill}" stroke="${K}" stroke-width="4.5" stroke-linejoin="round"/><path d="M42 76q12 7 24 0" stroke="${shade}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/></g><g class="c-face"><ellipse cx="40" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/><ellipse cx="68" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/><g class="c-eyes" style="${blink}">${eyes}</g><g class="c-mouth">${mouth}</g>${onFace ? COSTUME[costume] : ''}</g><g class="c-hat">${onFace ? '' : COSTUME[costume]}</g>`
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

type Costume = keyof typeof COSTUME
