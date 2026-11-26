import { cn } from '@/lib/utils'

const TONES = [
  ['#ffe3d8', '#a3401c'], ['#ece3ff', '#5b3fb0'], ['#d6f5ef', '#126b5f'], ['#fff2c7', '#8a5a00'],
  ['#dcecfd', '#1d5c9e'], ['#dcf5e4', '#23733f'], ['#fde1ee', '#a3336a'], ['#ffead2', '#9a4f00'],
] as const

function toneOf(email: string): readonly [string, string] {
  let hash = 2166136261
  for (const char of email.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507) >>> 0
  hash ^= hash >>> 13
  return TONES[(hash >>> 21) % TONES.length]
}

function initialsOf(name: string, two: boolean): string {
  const words = name.split(/[\s@._-]+/).filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  return (two && words.length > 1 ? first + (words[1]?.[0] ?? '') : first).toUpperCase()
}

export function PersonFace({ name, email, size = 36, className }: { name: string; email: string; size?: number; className?: string }) {
  const [soft, deep] = toneOf(email)
  const two = size >= 28
  return <span role="img" aria-label={name} title={name} className={cn('grid shrink-0 place-items-center rounded-full leading-none font-semibold tracking-[-0.02em] select-none', className)}
    style={{ width: size, height: size, background: soft, color: deep, fontSize: Math.max(7, Math.round(size * (two ? 0.38 : 0.44))) }}>
    {initialsOf(name || email, two)}
  </span>
}
