import type { Ask } from '@openhut/common/asks/ask.ts'

export type DiffLine = { kind: 'gone' | 'added' | 'same'; text: string }

const RISKY = /delete|remove|destroy|drop|purge|wipe/i

export function lineDiff({ before, after }: { before: string; after: string }): DiffLine[] {
  const old = before.split('\n').filter((line) => line.trim())
  const next = after.split('\n')
  const gone = old.filter((line) => !next.includes(line)).map((text): DiffLine => ({ kind: 'gone', text }))
  return [...gone, ...next.map((text): DiffLine => ({ kind: !old.includes(text) && text.trim() ? 'added' : 'same', text }))]
}

export function undoable(ask: Pick<Ask, 'input'>): boolean {
  const action = ask.input.action
  const tool = action && typeof action === 'object' && 'name' in action ? action.name : ask.input.tool
  return typeof tool === 'string' && RISKY.test(tool)
}

export function needsQrScan(ask: Pick<Ask, 'status' | 'input'>): boolean {
  return ask.status === 'done' && ask.input.kind === 'whatsapp'
}

export function webhookOf<T extends { name: string }>({ ask, webhooks }: { ask: Pick<Ask, 'status' | 'input'>; webhooks: T[] }): T | undefined {
  return ask.status === 'done' ? webhooks.filter((each) => each.name === ask.input.name).at(-1) : undefined
}
