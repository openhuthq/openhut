import type { Ask } from '@openhut/common/asks/ask.ts'
import type { ChatCall, ToolCall, ToolProgress, Work } from '@openhut/common/threads/thread.ts'
import { toolLabel } from '../../lib/tool-label.ts'

export type Step = { key: string; tool: string; title: string; detail?: string; count: number; done: boolean; call?: ChatCall }
export type StepKind = 'code' | 'web' | 'file' | 'memory' | 'app' | 'find' | 'other'

export function stepsOf(events: ToolProgress[]): Step[] {
  const steps: Step[] = []
  const byId = new Map<string, Step>()
  for (const event of events) {
    if (hidden(event.tool ?? event.name ?? event.label ?? 'tool')) continue
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    const known = id ? byId.get(id) : undefined
    if (known) {
      if (event.status === 'completed') known.done = true
      continue
    }
    const step = stepOf({ event, key: id ?? String(steps.length) })
    if (id) byId.set(id, step)
    steps.push(step)
  }
  return steps.reduce<Step[]>((merged, step) => {
    const last = merged.at(-1)
    if (last && !last.detail && !step.detail && last.title === step.title) merged[merged.length - 1] = { ...last, count: last.count + 1, done: last.done && step.done }
    else merged.push(step)
    return merged
  }, [])
}

export function attachCalls({ steps, calls }: { steps: Step[]; calls: ChatCall[] }): ChatCall[] {
  const left: ChatCall[] = []
  for (const call of calls) {
    if (hidden(call.tool)) continue
    const step = steps.find((candidate) => !candidate.call && candidate.title === call.tool)
    if (step) step.call = call
    else left.push(call)
  }
  return left
}

export function kindOf(tool: string): StepKind {
  if (/call_tool/.test(tool)) return 'app'
  if (/code|terminal|process|shell/.test(tool)) return 'code'
  if (/web|browser|url|fetch/.test(tool)) return 'web'
  if (/list_tools|describe_tool|search/.test(tool)) return 'find'
  if (/file|patch|read|write/.test(tool)) return 'file'
  if (/memory|skill|todo|session/.test(tool)) return 'memory'
  return 'other'
}

const HIDDEN = new Set(['get_self', 'list_tools', 'describe_tool'])

function hidden(tool: string) {
  return HIDDEN.has(shortName(tool))
}

const ARGUMENT_LABELS = new Set(['ask_to_connect'])

function stepOf({ event, key }: { event: ToolProgress; key: string }): Step {
  const tool = event.tool ?? event.name ?? event.label ?? 'tool'
  const label = event.label?.trim()
  const named = label && label !== tool && /^[\w.-]{1,64}$/.test(label) && !ARGUMENT_LABELS.has(shortName(tool))
  return {
    key,
    tool,
    title: named ? label : shortName(tool),
    detail: label && label !== tool && !named && !ARGUMENT_LABELS.has(shortName(tool)) ? label : undefined,
    count: 1,
    done: event.status === 'completed',
  }
}

function shortName(tool: string) {
  return tool.split('__').at(-1) || tool
}

const ORDER: Record<ToolCall['kind'], number> = { delete: 0, change: 1, other: 2, read: 3 }
const SHOWN = new Set<ToolCall['status']>(['done', 'running', 'asked'])

export function summaryOf(work: Work): string {
  const groups = new Map<string, ToolCall[]>()
  for (const call of work.calls.filter((each) => SHOWN.has(each.status))) groups.set(call.past, [...groups.get(call.past) ?? [], call])
  const ordered = [...groups.values()].sort((a, b) => ORDER[a[0].kind] - ORDER[b[0].kind])
  if (!ordered.length) return work.calls[0] ? `Tried to ${lower(work.calls[0].label)}` : ''
  const clauses = ordered.slice(0, 2).map((group, index) => {
    const clause = group.length > 1 ? `${group[0].past} ${times(group.length)}` : group[0].past
    return index ? lower(clause) : clause
  })
  const rest = ordered.slice(2).reduce((sum, group) => sum + group.length, 0)
  return rest ? `${clauses.join(', ')} and ${rest} more` : clauses.join(' and ')
}

export function troubleOf(work: Work) {
  const count = (status: ToolCall['status']) => work.calls.filter((call) => call.status === status).length
  return { failed: count('failed'), blocked: count('blocked'), asked: count('asked'), declined: count('declined') }
}

const ANSWERED = { open: 'asked', done: 'done', declined: 'declined', expired: 'declined' } as const

export function settleAsks({ work, asks }: { work: Work; asks: Ask[] }): Work {
  const left = [...asks]
  const calls = work.calls.map((call) => {
    if (call.status !== 'asked') return call
    const index = left.findIndex((ask) => ask.kind === call.tool || (ask.kind === 'call_tool' && ask.input.tool === call.tool))
    if (index < 0) return call
    const [ask] = left.splice(index, 1)
    return { ...call, status: ANSWERED[ask.status] }
  })
  return { ...work, calls }
}

export function noReplyOf(work: Work): string {
  const trouble = work.calls.find((call) => call.status === 'failed' || call.status === 'blocked')
  return `No reply — ${work.error ?? trouble?.error ?? 'it stopped without an answer.'}`
}

export function durationOf(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function legacyWork({ events, calls }: { events: ToolProgress[]; calls: ChatCall[] }): Work | undefined {
  const steps = stepsOf(events)
  const left = attachCalls({ steps, calls }).map((call, index): Step => ({ key: `call${index}`, tool: call.tool, title: call.tool, count: 1, done: true, call }))
  const all = [...steps, ...left].flatMap((step) => Array.from({ length: step.count }, (_, index): ToolCall => ({
    id: `${step.key}.${index}`, tool: step.title, app: step.call?.connectionName ?? null, kind: 'other',
    label: capital(toolLabel(step.title, 'now')), past: toolLabel(step.title), ...step.detail && { input: step.detail },
    ms: step.call?.ms ?? 0, status: step.call ? LEGACY[step.call.outcome] : 'done',
  })))
  return all.length ? { calls: all, ms: 0 } : undefined
}

const LEGACY = { allowed: 'done', asked: 'asked', denied: 'blocked', failed: 'failed' } as const

function times(count: number) {
  return count === 2 ? 'twice' : `${count} times`
}

function lower(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
