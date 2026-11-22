const K = '#0b0b0b'

export const MOODS = ['looking', 'key', 'building', 'asleep', 'worried', 'party', 'surprised'] as const
export type Mood = (typeof MOODS)[number]

type Parts = { eyes?: string; mouth?: string; hat?: string; prop?: string }

const BODY = `<g class="c-body"><rect x="27" y="53" width="54" height="45" rx="10" fill="#fbe3c8" stroke="${K}" stroke-width="5.5"/><path d="M54 20 92 56q3 6-4 6H20q-7 0-4-6z" fill="#f7c948" stroke="${K}" stroke-width="5.5" stroke-linejoin="round"/><path d="M37 41q4.5 4 9 0t9 0 9 0 9 0M25 52q4.8 4 9.7 0t9.7 0 9.7 0 9.7 0 9.7 0 9.7 0" stroke="#c9952a" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
const CHEEKS = `<ellipse cx="37" cy="83" rx="4.3" ry="2.7" fill="#f5a48c"/><ellipse cx="71" cy="83" rx="4.3" ry="2.7" fill="#f5a48c"/>`
const FLAG = `<path d="M54 20V9.5" stroke="${K}" stroke-width="3.4" stroke-linecap="round"/><path d="M55.5 9 69 13.5 55.5 18z" fill="#ff5a3c" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>`
const SMILE = `<path d="M49.5 85q4.5 4 9 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`
const eyes = (dx = 0, dy = 0) => `<ellipse cx="${44 + dx}" cy="${76 + dy}" rx="5.2" ry="6.2" fill="${K}"/><ellipse cx="${64 + dx}" cy="${76 + dy}" rx="5.2" ry="6.2" fill="${K}"/><circle cx="${46 + dx}" cy="${73.5 + dy}" r="2.1" fill="#fff"/><circle cx="${66 + dx}" cy="${73.5 + dy}" r="2.1" fill="#fff"/>`

const PARTS: Record<Mood, Parts> = {
  looking: {
    eyes: eyes(2, -1),
    mouth: `<path d="M50 87h8" stroke="${K}" stroke-width="3" stroke-linecap="round"/>`,
    prop: `<g class="c-prop prop-sweep"><path d="M93 92l6 6" stroke="${K}" stroke-width="5" stroke-linecap="round"/><circle cx="88" cy="87" r="8" fill="#fff" fill-opacity=".85" stroke="${K}" stroke-width="4"/></g>`,
  },
  key: {
    eyes: eyes(2, -1),
    mouth: `<path d="M50 85q4 3 8 0" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    prop: `<g class="c-prop prop-jig"><circle cx="92" cy="70" r="7" fill="#f7c948" stroke="${K}" stroke-width="3.6"/><circle cx="92" cy="70" r="2.2" fill="#fff" stroke="${K}" stroke-width="2"/><path d="M92 77v19M92 89h5M92 94h4" stroke="${K}" stroke-width="3.6" stroke-linecap="round"/></g>`,
  },
  building: {
    hat: `<path d="M38 25q16-19 32 0z" fill="#ff8f1f" stroke="${K}" stroke-width="3.6" stroke-linejoin="round"/><path d="M54 11v5" stroke="${K}" stroke-width="3" stroke-linecap="round"/><rect x="33" y="22.5" width="42" height="6" rx="3" fill="#ff8f1f" stroke="${K}" stroke-width="3.2"/>`,
    prop: `<g class="c-prop prop-turn"><path d="M90 74l9-9m-3-2 5 5-3 3-5-5z" stroke="${K}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="#d4d4d8"/></g>`,
  },
  asleep: {
    eyes: `<path d="M39 76q5 4 10 0M59 76q5 4 10 0" stroke="${K}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`,
    mouth: `<ellipse cx="54" cy="87" rx="3" ry="3.4" fill="${K}"/>`,
    hat: `<path d="M54 20V9.5" stroke="${K}" stroke-width="3.4" stroke-linecap="round"/><path d="M55 10q-6 4-12 2l2-8z" fill="#ff5a3c" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>`,
    prop: `<g class="c-prop"><path class="prop-rise" d="M84 32h8l-8 9h8" stroke="${K}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path class="prop-rise prop-late" d="M95 16h6l-6 7h6" stroke="${K}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  },
  worried: {
    eyes: `<path d="M38 69l10-4M70 69l-10-4" stroke="${K}" stroke-width="3" stroke-linecap="round"/><ellipse cx="44" cy="77" rx="4.6" ry="5.6" fill="${K}"/><ellipse cx="64" cy="77" rx="4.6" ry="5.6" fill="${K}"/><circle cx="45.5" cy="75" r="1.8" fill="#fff"/><circle cx="65.5" cy="75" r="1.8" fill="#fff"/>`,
    mouth: `<ellipse cx="54" cy="89" rx="3.6" ry="3" fill="none" stroke="${K}" stroke-width="3"/>`,
    prop: `<g class="c-prop prop-drip"><path d="M84 62q-4 6 0 8t4-2q0-2-4-6z" fill="#9ab7ff" stroke="${K}" stroke-width="2.4" stroke-linejoin="round"/></g>`,
  },
  surprised: {
    eyes: `<ellipse cx="44" cy="75" rx="6.4" ry="7.8" fill="${K}"/><ellipse cx="64" cy="75" rx="6.4" ry="7.8" fill="${K}"/><circle cx="46.4" cy="72" r="2.6" fill="#fff"/><circle cx="66.4" cy="72" r="2.6" fill="#fff"/>`,
    mouth: `<ellipse cx="54" cy="88.5" rx="2.8" ry="3.2" fill="none" stroke="${K}" stroke-width="2.8"/>`,
    prop: `<g class="c-prop"><path d="M87 61l6-4M89 69h7" stroke="${K}" stroke-width="3" stroke-linecap="round"/></g>`,
  },
  party: {
    eyes: `<path d="M39 77q5-7 10 0M59 77q5-7 10 0" stroke="${K}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`,
    mouth: `<path d="M47 84q7 7 14 0" stroke="${K}" stroke-width="3.2" fill="#ff8a6e" stroke-linecap="round" stroke-linejoin="round"/>`,
    hat: '',
    prop: `<g class="c-prop prop-party"><path d="M43 24l11-15 11 14z" fill="#9ab7ff" stroke="${K}" stroke-width="3.2" stroke-linejoin="round"/><path d="M48 18l10 3M51 13l6 2" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="54" cy="10" r="3.6" fill="#f7c948" stroke="${K}" stroke-width="2.6"/></g>`,
  },
}

export function hutArt(mood: Mood): string {
  const { eyes: look = eyes(), mouth = SMILE, hat = FLAG, prop = '' } = PARTS[mood]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 8 100 100">${BODY}<g class="c-face">${CHEEKS}<g class="c-eyes">${look}</g><g class="c-mouth">${mouth}</g></g><g class="c-hat">${hat}</g>${prop}</svg>`
}
