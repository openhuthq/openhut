const ink = '#0b0b0b'
const teal = '#19B3B1', cream = '#F2E3C6', coral = '#FF7A59', orange = '#ee8149'
const green = '#64ae59', mint = '#86c7b4', blue = '#3d8fdc', rose = '#e4587e'
const yellow = '#f7c948', lilac = '#b79cf2', periwinkle = '#9ab7ff', pink = '#f4a6c0'
const pine = '#0e7f7e'
const plum = '#8a72c4', denim = '#2e6ba5'
const swatches = [teal, cream, coral, orange, green, mint, blue, rose, yellow, lilac, periwinkle, pink]

function tint(hex: string, white: number) {
  const channels = hex.slice(1).match(/../g) ?? []
  return '#' + channels.map((c) => Math.round(parseInt(c, 16) * (1 - white) + 255 * white)
    .toString(16).padStart(2, '0')).join('')
}

const backgrounds = swatches.map(color => tint(color, 0.76))
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

const outline = (width: number) => width ? ` stroke="${ink}" stroke-width="${width}"` : ''
const path = (d: string, fill: string, width = 0) => `<path d="${d}" fill="${fill}"${outline(width)}/>`
const oval = (x: number, y: number, rx: number, ry: number, fill: string, width = 0) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"${outline(width)}/>`
const shape = (d: string, fill: string) => path(d, fill, 3)
const detail = (d: string) => path(d, 'none', 2.5)
const group = (transform: string, art: string) => `<g transform="${transform}">${art}</g>`
const dot = (x: number, y: number, r: number, color: string) => oval(x, y, r, r, color)

const moods = ['smile', 'grin', 'open', 'sleepy', 'wink', 'tongue'] as const
type Mood = (typeof moods)[number]
const mouths: Record<string, string> = {
  smile: 'M-7 0C-5-2-4 1-2 2Q1 4 6 0C8-2 10 0 7 3Q0 10-7 3Q-9 1-7 0Z',
  grin: 'M-7 0Q0 1 7 0C9 0 7 8 1 8C-5 8-9 0-7 0Z',
  sleepy: 'M-4 2Q0 4 4 1Q7 0 6 3Q2 8-4 5Q-7 3-4 2Z',
  wink: 'M-5 2Q0 4 5-1Q9-3 8 0Q5 7-3 6Q-7 6-5 2Z',
}

function face(mood: Mood, x: number, y: number, { spread = 11, mouthY = 7, size = 1, cheeks = false } = {}) {
  const eye = (dx: number) => oval(dx, 0, 3.15, 3.5, ink)
  const lid = (dx: number) => group(`translate(${dx} 0)`, path(
    mood === 'sleepy' ? 'M-4-1Q0 2 4-1Q6-2 5 1Q1 7-5 2Q-7-1-4-1Z'
      : 'M-5 1Q0-7 5 0Q7 4 4 3Q0 0-3 3Q-6 5-5 1Z', ink))
  const eyes = (mood === 'sleepy' ? lid(-spread) : eye(-spread))
    + (mood === 'sleepy' || mood === 'wink' ? lid(spread) : eye(spread))
  let mouth
  if (mood === 'open') {
    mouth = oval(0, 3, 4, 4.7, ink)
  } else if (mood === 'tongue') {
    mouth = path('M-7 0Q0 2 7-1C9 2 7 9 2 10C-3 10-4 7-4 5Q-9 4-7 0Z', ink)
      + path('M-2 5Q2 3 5 4Q5 9 2 9Q-1 9-2 5Z', pink)
  } else {
    mouth = path(mouths[mood], ink)
    if (mood === 'grin') mouth += path('M-4 2Q0 3 4 2Q2 6-1 5Q-3 5-4 2Z', cream)
  }
  const blush = cheeks ? oval(-spread - 4, 6, 4.3, 2.7, pink) + oval(spread + 4, 6, 4.3, 2.7, pink) : ''
  return group(`translate(${x} ${y}) scale(${size})`, blush + eyes + group(`translate(0 ${mouthY})`, mouth))
}


const pair = (art: string) => art + group('translate(100 0) scale(-1 1)', art)

function folk(pick: Pick, mood: Mood): [string, string] {
  const paper = '#ffffff'
  const hairColor = pick([ink, ink, '#55555f', '#6b3f24', '#a35a2c', '#d9b25a', denim, plum, pine])
  const shirt = pick(swatches.filter(color => color !== hairColor))
  const hair = (d: string) => shape(d, hairColor)
  const style = pick(['short', 'spiky', 'curly cloud', 'wavy', 'top bun', 'ponytail', 'pigtails',
    'long straight', 'bob', 'fringe', 'side part', 'swoop', 'messy', 'bald'])
  const crown = 'M18 49C15 30 29 14 49 14C69 13 84 28 82 49'
  const swept = crown + 'Q75 44 69 31C57 38 42 37 35 32Q31 42 18 49Z'
  let back = '', front = ''
  switch (style) {
    case 'short':
      front = hair(crown + 'L76 43L73 34Q61 38 52 32L44 36L42 32Q34 36 28 34L24 46Z')
      break
    case 'spiky':
      front = hair('M18 49Q15 40 18 32L13 29L27 24L24 17L38 19L42 9L49 17L63 11L62 18L73 16Q85 29 81 49L73 40L70 32L58 37L58 31L46 38L41 33L28 40L29 34Z')
      break
    case 'curly cloud':
      front = hair('M19 48C13 45 13 36 19 32C16 23 23 17 31 19C33 10 44 9 50 15C57 8 67 13 68 20C78 17 84 25 80 32C88 35 86 45 80 48Q72 46 72 36C66 40 59 38 57 32C51 40 42 39 39 33C35 40 28 39 26 36Q26 45 19 48Z')
      break
    case 'wavy':
      front = hair('M17 49C15 40 18 35 20 31Q12 32 13 27C23 27 24 17 35 19C44 21 46 11 58 13C77 15 85 31 82 48Q75 45 70 32C64 27 57 32 51 37Q40 44 34 36Q26 34 23 45Z')
      break
    case 'top bun':
      back = hair('M37 22C29 18 33 8 42 8C45 1 59 3 61 10C68 15 62 23 55 25Z')
        + detail('M41 14Q47 8 53 12')
      front = hair(swept)
      break
    case 'ponytail':
      back = hair('M66 28C76 15 87 22 87 36C87 47 89 50 94 48C93 63 76 65 76 49Q77 37 68 38Z')
        + shape('M68 27L75 23L80 32L73 36Z', shirt)
      front = hair(swept)
      break
    case 'pigtails':
      back = pair(hair('M24 35C15 30 10 37 10 47Q11 57 6 60C16 66 25 59 22 48Q20 42 27 41Z')
        + shape('M19 34L25 36L23 44L17 42Z', shirt))
      front = hair(crown + 'Q73 43 68 34Q57 36 49 29Q36 40 28 36Q25 45 18 49Z')
      break
    case 'long straight':
      back = hair('M18 43Q18 18 50 17Q80 17 82 44L85 81Q77 87 68 84L64 78L63 86Q43 90 34 85L30 78L29 85Q19 86 14 81Z')
      front = hair(crown + 'L80 65Q71 55 69 35Q55 32 49 25Q42 35 29 38Q27 55 20 66Z')
      break
    case 'bob':
      front = hair('M14 67C17 54 12 42 19 29C27 12 53 7 69 17C88 28 82 48 86 64Q81 70 72 68L72 38Q52 41 37 36L34 31L33 37L28 37Q29 54 26 69Q19 70 14 67Z')
      break
    case 'fringe':
      front = hair(crown + 'L74 45L73 36L60 39L58 33L56 40L40 41L36 36L35 41L27 41L24 49Z')
      break
    case 'side part':
      front = hair(crown + 'Q74 45 67 30Q65 25 63 24Q51 39 29 39L23 50Z')
        + detail('M59 18Q53 26 42 28')
      break
    case 'swoop':
      front = hair('M18 50Q14 42 19 31C9 25 18 13 32 16C42 18 46 5 60 10Q76 13 74 23Q86 31 82 48L75 44L68 30C58 43 37 42 29 35Q26 46 18 50Z')
        + detail('M34 25Q45 27 54 19')
      break
    case 'messy':
      front = hair('M17 49L18 38L12 39Q13 30 25 26L19 24Q25 16 38 18Q37 11 46 9L47 17Q59 10 66 14L62 19Q79 16 82 28L77 29Q87 38 81 49L72 36L65 39L65 33Q56 42 46 42L48 36Q35 41 30 36L25 47L23 42Z')
      break
    case 'bald':
      front = detail('M29 36Q32 29 38 27M42 25l2-.5')
      break
  }

  const props = ['round glasses', 'round glasses', 'freckles']
  if (!['spiky', 'curly cloud', 'top bun', 'swoop', 'messy'].includes(style)) props.push('headphones')
  const prop = pick([false, true]) ? pick(props) : ''
  let accessory = ''
  switch (prop) {
    case 'headphones':
      accessory = shape('M14 52C10 0 89-3 86 52L81 52C83 5 19 8 19 52Z', shirt)
        + pair(oval(16, 54, 6, 10, shirt, 3))
      break
    case 'round glasses':
      accessory = detail('M20 50L29 52M46 52Q50 49 54 52M71 52L80 49')
        + pair(oval(37.5, 52, 8.5, 8.5, 'none', 3))
      break
    case 'freckles':
      accessory = pair(dot(30, 59, 1.5, ink) + dot(35, 61.5, 1.4, ink) + dot(31, 64, 1.2, ink))
      break
  }
  const shoulders = 'M20 90Q29 82 40 81H60Q71 82 80 90'
  const collar = path(shoulders + 'A50 50 0 0 1 20 90Z', shirt)
    + path(shoulders + 'Q71 86 60 84H40Q29 86 20 90Z', ink)
    + shape('M42 77H58L59 85L50 92L41 85Z', paper)
    + pair(shape('M39 82L50 91L44 96L34 84Z', shirt))
  const ears = pair(oval(19, 54, 5.5, 6.5, paper, 3))
  const head = shape('M19 49C18 31 31 18 50 19C69 18 82 32 81 51C80 69 69 83 53 85C35 87 20 72 19 49Z', paper)
  const brows = prop === 'round glasses' || prop === 'sunglasses' ? ''
    : detail('M33 46q3-3 7-2M60 44q4-2 7 1')
  const noseLine = pick([false, true]) ? detail('M50 55q0 3-2 5q0 2 4 1') : ''
  return ['Person', back + collar + ears + head + front + brows + noseLine
    + face(mood === 'wink' ? 'wink' : 'smile', 50, 54, {spread: 11, mouthY: 11, size: 0.9, cheeks: false}) + accessory]
}

export function folkFace(seed: string): string {
  const pick = picker(seed + '/folks')
  const mood = pick(moods)
  const [, art] = folk(pick, mood)
  const angle = pick([-7, -4, 0, 4, 7])
  const facing = pick([false, true]) ? group('translate(100 0) scale(-1 1)', art) : art
  return `<circle cx="50" cy="50" r="50" fill="${pick(backgrounds)}"/>${group(`rotate(${angle} 50 50)`, facing)}`
}
