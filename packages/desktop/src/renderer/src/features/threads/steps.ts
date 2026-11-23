import type { ChatCall, ToolProgress } from '@openhut/common/threads/thread.ts'

export type Step = { key: string; tool: string; title: string; detail?: string; count: number; done: boolean; call?: ChatCall }
export type StepKind = 'code' | 'web' | 'file' | 'memory' | 'app' | 'find' | 'other'

export function stepsOf(events: ToolProgress[]): Step[] {
  const steps: Step[] = []
  const byId = new Map<string, Step>()
  for (const event of events) {
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
