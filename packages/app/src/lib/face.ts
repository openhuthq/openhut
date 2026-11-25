import { hash } from './hash.ts'

const K = '#0b0b0b'
export const INK_HAIR = '#26262b'
export const BROWN_HAIR = '#6b3f24'

export const SWATCHES = [
  { id: 'teal', name: 'Teal', fill: '#19B3B1', shade: '#0e7f7e' },
  { id: 'cream', name: 'Cream', fill: '#F2E3C6', shade: '#c9b48a' },
  { id: 'coral', name: 'Coral', fill: '#FF7A59', shade: '#c4553a' },
  { id: 'orange', name: 'Orange', fill: '#ee8149', shade: '#b36137' },
  { id: 'green', name: 'Green', fill: '#64ae59', shade: '#4b8343' },
  { id: 'mint', name: 'Mint', fill: '#86c7b4', shade: '#659587' },
  { id: 'blue', name: 'Blue', fill: '#3d8fdc', shade: '#2e6ba5' },
  { id: 'rose', name: 'Rose', fill: '#e4587e', shade: '#ab425f' },
  { id: 'yellow', name: 'Yellow', fill: '#f7c948', shade: '#c49a2c' },
  { id: 'lilac', name: 'Lilac', fill: '#b79cf2', shade: '#8a72c4' },
  { id: 'periwinkle', name: 'Periwinkle', fill: '#9ab7ff', shade: '#6f8bd1' },
  { id: 'pink', name: 'Pink', fill: '#f4a6c0', shade: '#c97d97' },
]

export const HAIR_COLORS = [
  ...SWATCHES.map(({ id, name, fill }) => ({ id, name, color: fill })),
  { id: 'ink', name: 'Ink', color: INK_HAIR },
  { id: 'brown', name: 'Brown', color: BROWN_HAIR },
]

const STROKE = `stroke="${K}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`

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
  specs: `<g fill="#fff" fill-opacity=".18" stroke="${K}" stroke-width="1.9"><circle cx="45" cy="54" r="8.6"/><circle cx="63" cy="54" r="8.6"/></g><path d="M53.6 53q.4-.8.8 0M36.4 52L30 50M71.6 52L78 50" fill="none" stroke="${K}" stroke-width="1.9" stroke-linecap="round"/>`,
  bowtie: `<g transform="translate(54 83)"><path d="M0 0l-11-6.5v13zM0 0l11-6.5v13z" fill="#e0382e" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/><rect x="-3.2" y="-3.6" width="6.4" height="7.2" rx="2" fill="#e0382e" stroke="${K}" stroke-width="2.2"/></g>`,
  shades: `<rect x="36" y="48" width="16" height="11" rx="4.5" fill="${K}"/><rect x="56" y="48" width="16" height="11" rx="4.5" fill="${K}"/><path d="M52 52h4M36 52l-6-3M72 52l6-3" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/><path d="M40 52h5M60 52h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`,
}

type Costume = keyof typeof COSTUME
export const HATS = ['cap', 'headset', 'beanie', 'crown', 'antenna', 'party', 'tophat', 'sprout', 'halo'] as const
export const EYEWEAR = ['glasses', 'specs', 'monocle', 'shades'] as const
export const EXTRAS = ['bow', 'bowtie', 'flower'] as const
export const HAIRS = ['tuft', 'fringe', 'curls', 'bun', 'pigtails', 'spikes', 'mohawk', 'swept', 'long'] as const
export type Hat = (typeof HATS)[number]
export type Eyewear = (typeof EYEWEAR)[number]
export type Extra = (typeof EXTRAS)[number]
export type Hair = (typeof HAIRS)[number]

export const NAMES: Record<Costume | Hair, string> = {
  cap: 'Cap', headset: 'Headset', beanie: 'Beanie', crown: 'Crown', antenna: 'Antenna', party: 'Party hat', tophat: 'Top hat', sprout: 'Sprout', halo: 'Halo',
  glasses: 'Glasses', specs: 'Round specs', bowtie: 'Bowtie', monocle: 'Monocle', shades: 'Shades', bow: 'Bow', flower: 'Flower',
  tuft: 'Tuft', fringe: 'Fringe', curls: 'Curls', bun: 'Bun', pigtails: 'Pigtails', spikes: 'Spikes', mohawk: 'Mohawk', swept: 'Swept', long: 'Long',
}

const SEEDED: Costume[] = ['cap', 'headset', 'glasses', 'beanie', 'bow', 'crown', 'antenna', 'party', 'tophat', 'flower', 'sprout', 'halo', 'monocle', 'shades']
const COSTUME_BY: [RegExp, Costume][] = [[/support|customer|inbox|reply|email/i, 'headset'], [/metric|report|posthog|numbers|analy/i, 'glasses'], [/triage|alert|issue|incident/i, 'cap'], [/order|deliver|field|ops|warehouse/i, 'beanie'], [/invoice|finance|money|pay/i, 'tophat'], [/sales|lead|deal/i, 'shades'], [/hir|recruit|people/i, 'bow']]

export const EYES = [
  { name: 'Round', art: `<circle cx="45" cy="54" r="3.2" fill="${K}"/><circle cx="63" cy="54" r="3.2" fill="${K}"/>` },
  { name: 'Calm', art: `<path d="M41 54q4-3 8 0M59 54q4-3 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  { name: 'Joy', art: `<path d="M41 56q4-6 8 0M59 56q4-6 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  { name: 'Wink', art: `<circle cx="45" cy="54" r="3.2" fill="${K}"/><path d="M59 55q4-5 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  { name: 'Shiny', art: `<circle cx="45" cy="54" r="4.2" fill="${K}"/><circle cx="63" cy="54" r="4.2" fill="${K}"/><circle cx="46.5" cy="52.5" r="1.4" fill="#fff"/><circle cx="64.5" cy="52.5" r="1.4" fill="#fff"/>` },
  { name: 'Sleepy', art: `<path d="M41 55h8M59 55h8" stroke="${K}" stroke-width="3" stroke-linecap="round"/>` },
  { name: 'Wide', art: `<circle cx="45" cy="54" r="5.4" fill="#fff" stroke="${K}" stroke-width="2.4"/><circle cx="63" cy="54" r="5.4" fill="#fff" stroke="${K}" stroke-width="2.4"/><circle cx="45" cy="54" r="2.3" fill="${K}"/><circle cx="63" cy="54" r="2.3" fill="${K}"/>` },
  { name: 'Droopy', art: `<path d="M41 53q4 4 8 0M59 53q4 4 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>` },
]

export const MOUTHS = [
  { name: 'Smile', art: `<path d="M48 65q6 5 12 -1" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: 'Soft', art: `<path d="M48 65q6 3 12 -1" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: 'Grin', art: `<path d="M49 64q5 8 10 0z" fill="${K}" stroke="${K}" stroke-width="2" stroke-linejoin="round"/>` },
  { name: 'Flat', art: `<path d="M49 66h10" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/>` },
  { name: 'Smirk', art: `<path d="M48 66q7 1 12 -4" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: 'Oh', art: `<ellipse cx="54" cy="67" rx="3" ry="3.6" fill="${K}"/>` },
  { name: 'Frown', art: `<path d="M48 69q6-5 12 0" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: 'Tongue', art: `<path d="M49 64q5 8 10 0z" fill="${K}" stroke="${K}" stroke-width="2" stroke-linejoin="round"/><ellipse cx="54" cy="67" rx="2.6" ry="1.8" fill="#ee7f98"/>` },
]

const open = (d: string, color: string) => `<path d="${d}" fill="${color}"/><path d="${d}" fill="none" ${STROKE}/>`
const closed = (d: string, color: string) => `<path d="${d}" fill="${color}" ${STROKE}/>`
const puffs = (list: number[][], color: string) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 1.6}" fill="${K}"/>`).join('') + list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join('')
const FRINGE = 'M29 48Q26 28 54 27Q82 28 79 48Q73 40 67 44Q61 38 54 44Q47 38 41 44Q35 40 29 48Z'

const HAIR: Record<Hair, { back?: (color: string) => string; front: (color: string) => string }> = {
  tuft: { front: (c) => open('M42 38Q40 26 47 22Q49 29 54 20Q59 29 61 22Q68 26 66 38', c) },
  fringe: { front: (c) => closed(FRINGE, c) },
  curls: { front: (c) => puffs([[34, 44, 7.5], [42, 35, 8], [54, 31, 8.5], [66, 35, 8], [74, 44, 7.5]], c) },
  bun: { front: (c) => puffs([[54, 21, 7.5]], c) + closed('M32 46Q30 30 54 29Q78 30 76 46Q70 38 54 38Q38 38 32 46Z', c) },
  pigtails: {
    back: (c) => `<ellipse cx="23" cy="66" rx="8" ry="12" fill="${c}" ${STROKE}/><ellipse cx="85" cy="66" rx="8" ry="12" fill="${c}" ${STROKE}/>`,
    front: (c) => closed('M31 46Q30 30 54 29Q78 30 77 46Q66 36 54 40Q42 36 31 46Z', c) + `<circle cx="28" cy="52" r="2.8" fill="#FF7A59" stroke="${K}" stroke-width="2"/><circle cx="80" cy="52" r="2.8" fill="#FF7A59" stroke="${K}" stroke-width="2"/>`,
  },
  spikes: { front: (c) => open('M30 44L32 28L41 36L46 22L54 33L62 22L67 36L76 28L78 44', c) },
  mohawk: { front: (c) => open('M46 38Q44 28 48 22Q50 28 52 16Q55 24 57 14Q59 24 61 21Q65 30 62 38', c) },
  swept: {
    front: (c) => closed('M60 31Q63 17 75 8Q74 18 71 26Q79 20 88 17Q79 26 73 34Z', c)
      + closed('M26 38Q16 31 8 33Q17 27 30 30Z', c)
      + closed('M27 66Q20 50 24 38Q31 24 54 24Q78 24 85 40Q89 52 81 66Q79 57 77 50L74 41L66 47L64 41L55 47L53 40L44 46L42 41L34 46L32 42L30 52Q29 58 27 66Z', c)
      + `<path d="M64 27L58 35L62 37L55 44M40 31Q37 38 35 44M73 32Q76 38 77 44" fill="none" stroke="${K}" stroke-opacity=".3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  long: {
    back: (c) => closed('M24 58Q20 34 54 28Q88 34 84 58L87 92Q78 97 72 88L36 88Q30 97 21 92Z', c),
    front: (c) => closed(FRINGE, c),
  },
}

const VIEWS = { full: '4 8 100 100', head: '22 6 64 64', face: '24 32 60 60' }
export const FULL_VIEW = VIEWS.full

export type Look = {
  seed: string
  body: number
  eyes: number
  mouth: number
  hair: Hair | null
  hairColor: number
  hat: Hat | null
  eyewear: Eyewear | null
  extra: Extra | null
  bg: string | null
}

const BACKGROUNDS = ['white', 'grey', ...SWATCHES.map(({ id }) => id)]
const INK = HAIR_COLORS.findIndex(({ id }) => id === 'ink')

export function bgColor(id: string | null) {
  if (id === 'white') return '#ffffff'
  if (id === 'grey') return '#ececee'
  const swatch = SWATCHES.find((each) => each.id === id)
  return swatch ? tint(swatch.fill) : null
}

function tint(hex: string) {
  const value = parseInt(hex.slice(1), 16)
  return '#' + [value >> 16, (value >> 8) & 255, value & 255].map((channel) => Math.round(255 * .78 + channel * .22).toString(16).padStart(2, '0')).join('')
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

function blobFrom(seed: string) {
  const random = randomFrom(seed)
  for (let i = 0; i < 14; i++) random()
  return Array.from({ length: 10 }, (_, i) => {
    const turn = i / 10 * Math.PI * 2, radius = 26 + (random() - .5) * 4
    return [54 + Math.cos(turn) * radius * 1.05, 58 + Math.sin(turn) * radius * .97]
  })
}

export function randomLook({ seed, about = '' }: { seed: string; about?: string }): Look {
  const random = randomFrom(seed)
  for (let i = 0; i < 24; i++) random()
  const eyes = Math.floor(random() * 5)
  const shape = random()
  const item = COSTUME_BY.find(([pattern]) => pattern.test(about))?.[1] ?? SEEDED[hash(seed + 'c') % SEEDED.length]
  return {
    seed,
    body: hash(seed) % SWATCHES.length,
    eyes,
    mouth: shape > .72 ? 2 : shape > .35 ? 0 : 1,
    hair: null,
    hairColor: INK,
    hat: HATS.find((each) => each === item) ?? null,
    eyewear: EYEWEAR.find((each) => each === item) ?? null,
    extra: EXTRAS.find((each) => each === item) ?? null,
    bg: null,
  }
}

export function parseLook(value: unknown): Look | null {
  if (typeof value !== 'object' || value === null) return null
  const saved: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if (typeof saved.seed !== 'string') return typeof saved.id === 'string' && typeof saved.about === 'string' ? randomLook({ seed: saved.id, about: saved.about }) : null
  const base = randomLook({ seed: saved.seed })
  const index = (field: unknown, length: number, fallback: number) => typeof field === 'number' && Number.isInteger(field) && field >= 0 && field < length ? field : fallback
  const part = <T extends string>(list: readonly T[], field: unknown) => list.find((each) => each === field) ?? null
  return {
    seed: saved.seed,
    body: index(saved.body, SWATCHES.length, base.body),
    eyes: index(saved.eyes, EYES.length, base.eyes),
    mouth: index(saved.mouth, MOUTHS.length, base.mouth),
    hair: part(HAIRS, saved.hair),
    hairColor: index(saved.hairColor, HAIR_COLORS.length, INK),
    hat: part(HATS, saved.hat),
    eyewear: part(EYEWEAR, saved.eyewear),
    extra: part(EXTRAS, saved.extra),
    bg: part(BACKGROUNDS, saved.bg),
  }
}

export function faceArt({ look, tile = false }: { look: Look; tile?: boolean }) {
  const swatch = SWATCHES[look.body]
  const color = HAIR_COLORS[look.hairColor].color
  const hair = look.hair ? HAIR[look.hair] : null
  const ground = tile && look.bg ? `<rect x="4" y="8" width="100" height="100" rx="18" fill="${bgColor(look.bg)}"/>` : ''
  const body = `<g class="c-body"><path d="${smooth(blobFrom(look.seed))}" fill="${swatch.fill}" stroke="${K}" stroke-width="4.5" stroke-linejoin="round"/><path d="M42 76q12 7 24 0" stroke="${swatch.shade}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/></g>`
  const face = `<g class="c-face"><ellipse cx="40" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/><ellipse cx="68" cy="62" rx="4" ry="2.5" fill="#EDB5AE"/><g class="c-eyes" style="animation-delay:-${(hash(look.seed + 'b') % 48) / 10}s">${EYES[look.eyes].art}</g><g class="c-mouth">${MOUTHS[look.mouth].art}</g>${look.eyewear ? COSTUME[look.eyewear] : ''}</g>`
  const top = `<g class="c-hat">${hair ? hair.front(color) : ''}${look.hat ? COSTUME[look.hat] : ''}${look.extra ? COSTUME[look.extra] : ''}</g>`
  return ground + (hair?.back ? hair.back(color) : '') + body + face + top
}

export function faceUri({ look, view = 'full', size, tile = false }: { look: Look; view?: keyof typeof VIEWS; size: number; tile?: boolean }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWS[view]}" width="${size}" height="${size}">${faceArt({ look, tile: tile && view === 'full' })}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
