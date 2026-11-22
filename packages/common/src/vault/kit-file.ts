import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { fromBase64, sha256 } from './vault.ts'

export const KIT_MARK = 'openhut-kit/1'

export type KitFile = { words: string[]; email: string | null; kitId: string | null; valid: boolean }

const WORDS = new Set(wordlist)
const MARK = /openhut-kit\/1[ \t]+(\S+@\S+)[ \t]+(K-[0-9A-F]{4}-[0-9A-F]{4})/i
const NUMBERED = /(\d{1,2})\s*[.)]\s*([a-z]+)/gi
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export async function kitId(box: string): Promise<string> {
  const hex = Array.from((await sha256(fromBase64(box))).subarray(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `K-${hex.slice(0, 4)}-${hex.slice(4)}`
}

export function kitText({ email, madeAt, device, kitId, words }: { email: string; madeAt: string; device: string; kitId: string; words: string[] }): string {
  const cell = (index: number) => `${String(index + 1).padStart(2)}. ${words[index]}`
  const rows = [0, 1, 2, 3].map((row) => `${cell(row).padEnd(14)}${cell(row + 4).padEnd(15)}${cell(row + 8)}`)
  return [
    'OpenHut Recovery Kit',
    `Account   ${email}`,
    `Made      ${DAY.format(new Date(madeAt))}, on ${device}`,
    `Kit       ${kitId}`,
    '',
    'With your Google account, these 12 words open',
    'OpenHut Cloud on a new Mac. We can\'t reset them.',
    'Keep this file offline, like a password manager',
    'or a USB stick.',
    '',
    ...rows,
    '',
    'To restore: open OpenHut on the new Mac, sign in',
    'with Google, choose "Use my recovery kit", and',
    'drop this file in.',
    '',
    `${KIT_MARK} ${email} ${kitId}`,
    '',
  ].join('\n')
}

export function readKit(text: string): KitFile | null {
  const mark = MARK.exec(text)
  const rest = mark ? text.replace(mark[0], ' ') : text
  const words = numbered(rest) ?? loose(rest)
  if (!words) return null
  return { words, email: mark?.[1].toLowerCase() ?? null, kitId: mark?.[2].toUpperCase() ?? null, valid: validKit(words) }
}

export function validKit(words: string[]): boolean {
  return words.length === 12 && validateMnemonic(words.join(' '), wordlist)
}

export function kitWord(word: string): boolean {
  return WORDS.has(word.trim().toLowerCase())
}

export function nearestWord(word: string): string {
  const typed = word.trim().toLowerCase()
  let best = wordlist[0]
  let score = Infinity
  for (const each of wordlist) {
    const far = distance({ a: typed, b: each })
    if (far < score) [best, score] = [each, far]
  }
  return best
}

function numbered(text: string): string[] | null {
  const found = new Map<number, string>()
  for (const [, number, word] of text.matchAll(NUMBERED)) if (!found.has(Number(number))) found.set(Number(number), word.toLowerCase())
  const words = Array.from({ length: 12 }, (_, index) => found.get(index + 1))
  return words.every((word) => word !== undefined) ? words : null
}

function loose(text: string): string[] | null {
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? []
  const windows = tokens.map((_, start) => tokens.slice(start, start + 12)).filter((window) => window.length === 12 && window.every((word) => WORDS.has(word)))
  return windows.find(validKit) ?? windows[0] ?? null
}

function distance({ a, b }: { a: string; b: string }): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}
