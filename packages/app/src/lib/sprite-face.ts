const ink = '#0b0b0b'
const teal = '#19B3B1', coral = '#FF7A59', orange = '#ee8149'
const green = '#64ae59', blue = '#3d8fdc', rose = '#e4587e'
const yellow = '#f7c948', lilac = '#b79cf2', periwinkle = '#9ab7ff'
const pine = '#0e7f7e', plum = '#8a72c4', denim = '#2e6ba5'

function mix(a: string, b: string, amount: number) {
  const channels = [1, 3, 5].map(i => {
    const from = parseInt(a.slice(i, i + 2), 16)
    const to = parseInt(b.slice(i, i + 2), 16)
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0')
  })
  return '#' + channels.join('')
}

const tint = (color: string, amount: number) => mix(color, '#ffffff', amount)
type Pick = <T>(choices: readonly T[]) => T

function picker(seed: string): Pick {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  }
  state = state || 1
  return <T,>(choices: readonly T[]): T => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return choices[Math.floor((state >>> 0) / 4294967296 * choices.length)]
  }
}

const path = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`
const line = (d: string, stroke: string, width: number) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`
const oval = (x: number, y: number, rx: number, ry: number, fill: string) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`
const group = (transform: string, art: string) => `<g transform="${transform}">${art}</g>`
const spritePalette: Record<string, [string, string[]]> = {
  [teal]: [pine, [coral, rose, yellow]],
  [coral]: ['#c4553a', [teal, blue, periwinkle]],
  [orange]: ['#b36137', [teal, blue, lilac]],
  [green]: ['#4b8343', [rose, lilac, coral]],
  [blue]: [denim, [yellow, orange, coral]],
  [rose]: ['#ab425f', [green, teal, yellow]],
  [yellow]: ['#c49a2c', [blue, lilac, teal]],
  [lilac]: [plum, [green, yellow, orange]],
  [periwinkle]: ['#6f8bd1', [coral, yellow, orange]],
}

const outlined = (d: string, fill: string, width = 2.5) =>
  `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${width}"/>`
const shine = (d: string) => path(d, '#fff')
const sparkle = (x: number, y: number, size: number) => group(`translate(${x} ${y}) scale(${size})`,
  shine('M0-6Q1-1 5 0Q1 1 0 6Q-1 1-5 0Q-1-1 0-6Z'))

type Spirit = { colors: string[]; eyes: number[]; items: string[]; body: string; band: string; details: (color: string, shade: string) => string; armY?: number; shoot?: string }

const spirits: Record<string, Spirit> = {
  water: {
    colors: [teal, blue, periwinkle], eyes: [49, 54], items: ['drop', 'bubble'],
    body: 'M56 11C55 27 80 38 80 55C81 72 68 84 50 84C32 84 20 74 20 58C20 41 40 33 51 15Q55 8 56 11Z',
    band: 'M75 41Q80 48 80 55C81 72 68 84 50 84Q32 84 24 72C38 81 60 76 68 65Q76 55 75 41Z',
    details: () => shine('M43 34C41 39 34 43 31 49Q28 53 28 48C29 42 35 36 40 33Q44 30 43 34Z')
      + oval(27, 55, 1.8, 2.4, '#fff') + line('M61 75q6-2 9-6', '#fff', 2.5),
  },
  leaf: {
    colors: [green, teal, yellow, orange], eyes: [47, 50], items: ['twig', 'drop'],
    body: 'M78 15C75 28 84 46 73 62C63 77 45 83 28 75L24 81Q21 82 20 79L24 71C13 53 23 35 36 28C49 20 67 25 78 15Z',
    band: 'M78 15C75 28 84 46 73 62C63 77 45 83 28 75L24 81Q21 82 20 79L24 71Q41 79 57 69C73 59 75 37 78 15Z',
    details: (_, shade) => line('M25 75q4-5 10-9m-5 5 1-7M57 40q10-7 17-17m-10 12 1-7m-5 10 9-1', shade, 2.5)
      + shine('M30 38Q35 29 47 29Q49 30 46 32Q36 34 33 39Q29 43 30 38Z'),
  },
  flame: {
    colors: [orange, coral, yellow], eyes: [50, 51], items: ['spark'],
    body: 'M56 10C54 24 68 27 67 39Q74 35 73 28C83 41 85 59 76 72C66 87 39 88 26 74C14 61 19 45 28 34Q27 44 33 44C32 28 50 25 56 10Z',
    band: 'M73 28C83 41 85 59 76 72C66 87 39 88 26 74Q20 68 19 59C27 73 42 79 59 74C74 70 80 51 73 28Z',
    details: color => path('M29 67C36 69 36 65 34 59Q43 64 45 70Q49 75 55 72Q62 69 65 62Q69 75 59 79Q39 86 29 67Z', color === yellow ? orange : yellow)
      + shine('M51 25Q50 30 45 36Q42 40 40 39Q38 36 43 31Z') + oval(38, 43, 1.8, 2, '#fff'),
  },
  cloud: {
    colors: [periwinkle, blue, lilac, teal], eyes: [50, 51], items: ['drop', 'flake'], armY: 7,
    body: 'M28 45C25 34 37 29 45 35C50 17 75 20 73 42C81 41 86 48 84 58Q83 65 77 69Q71 75 62 72Q51 79 39 73C26 77 16 70 16 59Q15 47 28 45Z',
    band: 'M84 58Q83 65 77 69Q71 75 62 72Q51 79 39 73C26 77 16 70 16 59Q22 70 38 65Q49 72 61 65Q76 69 84 58Z',
    details: (_, shade) => line('M20 50q4-5 10-3m34-2q3-4 10-3', shade, 2.5)
      + shine('M51 36Q53 28 61 28Q66 28 64 31Q57 31 54 37Q51 41 51 36Z'),
  },
  star: {
    colors: [yellow, rose, lilac, coral, orange], eyes: [50, 49], items: ['spark'], armY: 5,
    body: 'M45 19Q50 5 55 18L63 35L80 37Q93 38 83 48L70 59L73 75Q75 89 63 82L50 74L35 82Q23 88 27 74L30 59L17 48Q7 38 21 37L38 35Z',
    band: 'M83 48L70 59L73 75Q75 89 63 82L50 74L35 82Q23 88 27 74L29 69Q28 79 37 74L50 67L66 76L63 56Z',
    details: (_, shade) => line('M53 22l5 12M21 42l8 3', shade, 2.5)
      + shine('M49 21Q51 18 51 22L48 33Q46 38 43 37Q41 36 43 32Z') + sparkle(65, 69, 0.57),
  },
  pebble: {
    colors: [lilac, teal, rose, orange, periwinkle], eyes: [50, 52], items: ['twig', 'crystal'],
    body: 'M19 51C22 41 37 36 46 29Q57 22 66 29Q73 33 77 44C83 50 87 60 80 67Q72 78 54 79L36 78C20 78 13 66 19 51Z',
    band: 'M77 44C83 50 87 60 80 67Q72 78 54 79L36 78C25 78 18 72 17 64L32 70L51 73L68 67L79 58Z',
    details: (_, shade) => path('M22 52Q33 47 42 37Q35 49 20 57ZM58 29l6 2 7 7-5-1Z', shade)
      + oval(36, 43, 2.1, 1.6, shade) + oval(40, 39, 1.4, 1.2, ink) + oval(73, 59, 2, 1.6, ink)
      + oval(70, 63, 1.5, 1.1, shade) + shine('M44 35q6-7 13-6 2 1-1 3l-10 4q-4 1-2-1Z'),
  },
  snowball: {
    colors: [blue, periwinkle, lilac], eyes: [49, 51], items: ['flake'],
    body: 'M21 48Q18 39 27 32Q30 24 39 24Q46 17 56 22Q67 19 73 30Q82 34 79 44Q86 53 79 62Q78 72 67 76Q60 84 50 80Q39 85 32 77Q20 76 21 66Q14 57 21 48Z',
    band: 'M79 44Q86 53 79 62Q78 72 67 76Q60 84 50 80Q39 85 32 77Q20 76 21 66Q27 72 34 69Q41 77 50 71Q59 76 64 68Q74 69 74 60Q82 54 79 44Z',
    details: (_, shade) => sparkle(36, 36, 1.17) + sparkle(44, 30, 0.56) + sparkle(70, 45, 0.66)
      + line('M55 28q4-2 7 1M26 62l2 2', shade, 2.5),
  },
  sprout: {
    colors: [orange, yellow, coral, green], eyes: [50, 55], items: ['twig', 'drop'],
    shoot: line('M49 38q2-11 6-16', ink, 3)
      + outlined('M52 30Q38 32 33 20Q45 17 52 30Z', green)
      + outlined('M52 28Q52 13 70 12Q69 25 52 28Z', green) + line('M57 23l6-5', '#4b8343', 2.5),
    body: 'M24 46C25 35 36 32 49 33C65 31 76 35 77 46C80 62 70 75 58 80L50 86Q48 87 46 83C30 80 18 64 24 46Z',
    band: 'M77 46C80 62 70 75 58 80L50 86Q48 87 46 83Q34 80 28 71Q51 83 67 63Q73 56 72 46Z',
    details: (_, shade) => outlined('M24 46C25 35 36 32 49 33C65 31 76 35 77 46Q71 50 65 47Q59 51 52 48Q44 52 37 48Q29 51 24 46Z', shade)
      + line('M32 41q3 3 6 0m5-3q3 3 6 0m7 3q3 3 6 0', ink, 2.5)
      + shine('M27 53q2-4 4-1l-1 7q-2 4-4 0Z'),
  },
  bubble: {
    colors: [teal, periwinkle, rose, lilac, blue], eyes: [50, 49], items: ['bubble', 'drop'],
    body: 'M81 50C81 68 68 82 50 82C32 82 19 68 19 50C19 32 32 19 50 19C68 19 81 32 81 50Z',
    band: 'M75 31Q81 39 81 50C81 68 68 82 50 82Q32 82 23 66C42 84 72 70 75 49Q77 39 75 31Z',
    details: color => line('M65 33q5 3 6 9M37 71q6 3 11 3', color === lilac || color === rose ? periwinkle : lilac, 3)
      + shine('M29 39C31 32 39 26 45 26Q49 26 46 30C39 32 36 34 32 40Q28 43 29 39Z')
      + oval(26, 46, 1.9, 2.7, '#fff') + sparkle(68, 65, 0.75)
      + outlined('M81 20a4 4 0 1 1-8 0a4 4 0 1 1 8 0Z', color) + oval(76, 19, 1.2, 1.2, '#fff'),
  },
  crystal: {
    colors: [lilac, teal, blue, rose, periwinkle], eyes: [49, 49], items: ['crystal', 'spark'],
    body: 'M21 39L44 16L61 18L79 34L77 63L57 84L36 80L20 64Z',
    band: 'M61 18L79 34L77 63L57 84L36 80L20 64L33 67L59 70L67 38Z',
    details: (_, shade) => path('M21 39L44 16L33 36L30 46Z', shade)
      + line('M21 39l12-3 34 2 12-4M44 16 33 36m28-18 6 20-4 26M20 64l13 3 26 3 18-7m-18 7-2 14', ink, 2.5)
      + shine('M38 32L45 21L54 22L44 32Z') + shine('M71 41l4-2-2 13-3 4Z'),
  },
}

const spriteSmile = line('M-6 11q6 5 12-1', ink, 2.6)
const roundEye = (x: number) => oval(x, 0, 3.2, 3.2, ink)
const spriteEyes = roundEye(-9) + roundEye(9)
const spriteFaces = [
  spriteEyes + spriteSmile,
  line('M-13 2q4-6 8 0M5 2q4-6 8 0', ink, 3) + outlined('M-5 10q5 8 10 0z', ink, 2),
  roundEye(-9) + line('M5 1q4-5 8 0', ink, 3) + spriteSmile,
  line('M-13 1h8M5 1h8', ink, 3) + line('M-6 11q6 3 12-1', ink, 2.6),
  spriteEyes + oval(0, 13, 3, 3.6, ink),
  oval(-9, 0, 4.2, 4.2, ink) + oval(9, 0, 4.2, 4.2, ink)
    + oval(-7.5, -1.5, 1.4, 1.4, '#fff') + oval(10.5, -1.5, 1.4, 1.4, '#fff') + spriteSmile,
]
const spriteBlush = oval(-14, 8, 4, 2.5, '#EDB5AE') + oval(14, 8, 4, 2.5, '#EDB5AE')

const spiritArms: Record<string, string> = {
  wave: 'M35 63Q20 69 16 53C15 48 11 49 11 54Q12 75 35 69Z',
  low: 'M36 62Q22 60 16 70C13 75 17 77 20 73Q25 66 36 68Z',
  out: 'M36 61Q22 66 14 61C10 59 8 63 12 66Q23 74 36 67Z',
  hold: 'M36 61Q22 68 15 59Q12 56 10 59Q8 62 12 65Q22 75 36 67Z',
}
const spiritItems: Record<string, string> = {
  drop: outlined('M0-14C0-11 5-8 5-5a5 5 0 0 1-10 0Q-5-9 0-14Z', blue)
    + oval(-1.6, -6, 1.1, 1.7, '#fff'),
  twig: line('M0 2q-2-7 2-15m-3 10-4-4', ink, 2.5)
    + outlined('M0-7q-7 0-7-7 7 0 7 7Z', green) + outlined('M1-10q1-7 8-7-1 6-8 7Z', green),
  spark: outlined('M0-16Q1-9 6-8Q1-6 0 0Q-1-6-6-8Q-1-9 0-16Z', yellow),
  flake: line('M0 0v-14m-5.8 3.5 11.6 7m-11.6 0 11.6-7', ink, 3)
    + oval(0, -7, 2.3, 2.3, periwinkle),
  bubble: outlined('M5-5a5 5 0 1 1-10 0a5 5 0 1 1 10 0Z', lilac) + oval(-1.5, -6.5, 1.5, 1.5, '#fff'),
  crystal: outlined('M0 0l-4-5 1-6 4-3 4 5-1 6Z', teal) + line('M1-10l-1 5', '#fff', 2),
}

export function spriteFace(seed: string): string {
  const pick = picker(seed + '/sprite')
  const spirit = pick(Object.values(spirits))
  const color = pick(spirit.colors)
  const [shade, contrasts] = spritePalette[color]
  const background = tint(pick(contrasts), 0.76)
  const pose = pick(['hold', 'hold', 'wave', 'low', 'out'])
  const item = pose === 'hold' ? group('translate(13 59)', spiritItems[pick(spirit.items)]) : ''
  const arms = outlined(spiritArms[pose], color) + item
    + group('translate(100 0) scale(-1 1)', outlined(spiritArms[pick(['wave', 'low', 'out'])], color))
  const body = path(spirit.body, color) + path(spirit.band, shade) + spirit.details(color, shade)
    + line(spirit.body, ink, 3)
  const [x, y] = spirit.eyes
  const face = group(`translate(${x} ${y})`, spriteBlush + pick(spriteFaces))
  const tilt = pick([-8, -4, 0, 4, 8])
  const mirrorArms = pick([true, false]) ? ' translate(100 0) scale(-1 1)' : ''
  const limbs = group(`translate(0 ${spirit.armY || 0})${mirrorArms}`, arms)
  const art = group(`rotate(${tilt} 50 50)`, limbs + (spirit.shoot || '') + body + face)
  return `<circle cx="50" cy="50" r="50" fill="${background}"/>${art}`
}

