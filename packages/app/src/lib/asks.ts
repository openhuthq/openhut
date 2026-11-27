import type { ComponentType } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'

export type AskRow = ComponentType<{ agent: Agent; ask: Ask; compact: boolean }>
export type AskExtra = ComponentType<{ agent: Agent; ask: Ask }>

export type DiffLine = { kind: 'gone' | 'added' | 'same'; text: string }

export function lineDiff({ before, after }: { before: string; after: string }): DiffLine[] {
  const old = before.split('\n').filter((line) => line.trim())
  const next = after.split('\n')
  const gone = old.filter((line) => !next.includes(line)).map((text): DiffLine => ({ kind: 'gone', text }))
  return [...gone, ...next.map((text): DiffLine => ({ kind: !old.includes(text) && text.trim() ? 'added' : 'same', text }))]
}

export function undoable(ask: Pick<Ask, 'input'>): boolean {
  return ask.input.destructive === true
}

export function needsQrScan(ask: Pick<Ask, 'status' | 'input'>): boolean {
  return ask.status === 'done' && ask.input.kind === 'whatsapp'
}

export function webhookOf<T extends { name: string }>({ ask, webhooks }: { ask: Pick<Ask, 'status' | 'input'>; webhooks: T[] }): T | undefined {
  return ask.status === 'done' ? webhooks.filter((each) => each.name === ask.input.name).at(-1) : undefined
}

export type ToolChoice = 'always' | 'once' | 'decline'

export function toolChoices(ask: Pick<Ask, 'input'>): ToolChoice[] {
  return undoable(ask) ? ['once', 'decline'] : ['always', 'once', 'decline']
}

export function toolAnswer(choice: ToolChoice): { verb: 'approvals' | 'declines'; body: object } {
  if (choice === 'decline') return { verb: 'declines', body: {} }
  return { verb: 'approvals', body: { answer: { always: choice === 'always' } } }
}

export function toolOutcome(ask: Pick<Ask, 'status' | 'input'>): string | undefined {
  if (ask.status === 'done') return ask.input.always === true ? 'Always allowed' : 'Allowed once'
  if (ask.status === 'declined') return 'Declined'
  if (ask.status === 'expired') return 'Expired'
  return undefined
}

export function toolDetails(ask: Pick<Ask, 'input'>): string[] {
  const args = ask.input.arguments && typeof ask.input.arguments === 'object' && Object.keys(ask.input.arguments).length ? JSON.stringify(ask.input.arguments, null, 2).split('\n') : []
  return [String(ask.input.name ?? ask.input.tool ?? ''), ...args]
}
