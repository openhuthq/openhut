import type { AskExtra, AskKinds, AskRow } from '@/lib/asks'

const found = import.meta.glob<{ rows?: Record<string, AskRow>; extras?: Record<string, AskExtra>; cards?: Record<string, AskExtra> }>('../features/*/asks.tsx', { eager: true })

export const ASK_KINDS: AskKinds = {
  rows: Object.assign({}, ...Object.values(found).map((each) => each.rows)),
  extras: Object.assign({}, ...Object.values(found).map((each) => each.extras)),
  cards: Object.assign({}, ...Object.values(found).map((each) => each.cards)),
}
