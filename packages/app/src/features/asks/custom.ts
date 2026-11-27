import type { AskExtra, AskRow } from '@/lib/asks'

const found = import.meta.glob<{ rows?: Record<string, AskRow>; extras?: Record<string, AskExtra>; cards?: Record<string, AskExtra> }>('../*/asks.tsx', { eager: true })

export const custom: Record<string, AskRow | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.rows))
export const extras: Record<string, AskExtra | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.extras))
export const cards: Record<string, AskExtra | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.cards))
