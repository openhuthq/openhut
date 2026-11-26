import { Alert02Icon, ArrowRight01Icon, SquareLock02Icon, UserIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { ToolCall, Work } from '@openhut/common/threads/thread.ts'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Glyph } from '@/components/glyph'
import { STEP_ICONS } from '@/components/icons'
import { I, PILL } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { navigate } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useAgentTools, useConnections, useSetToolPermission } from '@/features/connections/api'
import { connectionBrand } from '@/features/connections/catalog'
import { durationOf, kindOf, summaryOf, troubleOf } from '@/features/threads/steps'

const LIVE = 'animate-[shimmer_1.4s_linear_infinite] bg-[linear-gradient(90deg,var(--mute)_30%,var(--ink)_50%,var(--mute)_70%)] bg-size-[200%_100%] bg-clip-text text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-mute'

export function WorkLine({ agent, work, live, answered, onRetry }: { agent: Agent; work: Work; live: boolean; answered: boolean; onRetry?: () => void }) {
  const running = live ? work.calls.filter((call) => call.status === 'running').at(-1) : undefined
  const { failed, blocked, asked } = troubleOf(work)
  const marks = [...new Map(work.calls.map((call) => [call.connectionId ?? kindOf(call.tool), call])).values()].slice(0, 3)
  if (running) return <div className="flex min-w-0 items-center gap-2 py-[3px] text-[12.5px] text-mute" role="status">
    <Spinner className="mt-0 size-3.5 shrink-0" />
    <span className={cn('truncate', LIVE)}>{running.label}…</span>
  </div>
  return <>
    <Collapsible defaultOpen={work.error !== undefined} className="text-[12.5px] text-mute">
      <CollapsibleTrigger className="group/work -ml-1 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-[3px] pr-2 pl-1 text-left text-inherit hover:bg-tint">
        <span className="flex shrink-0 items-center gap-1">{marks.map((call) => <Mark key={call.id} call={call} />)}</span>
        <span className="truncate">{summaryOf(work)}</span>
        {work.ms > 10_000 && <span className="shrink-0 text-mute-2">· {durationOf(work.ms)}</span>}
        {failed > 0 && <span className="shrink-0 text-fail">· {failed} failed</span>}
        {blocked > 0 && <span className="shrink-0 text-fail">· {blocked} blocked</span>}
        {asked > 0 && <span className="shrink-0 text-ink">· waiting on you</span>}
        <I icon={ArrowRight01Icon} size={12} className="shrink-0 text-mute-2 [transition:transform_.15s] group-data-panel-open/work:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent><ul className="mt-1 mr-0 mb-0.5 ml-[9px] flex list-none flex-col gap-0.5 border-l-[1.5px] border-hair py-0.5 pr-0 pl-3">
        {work.calls.map((call) => <Row key={call.id} call={call} />)}
        {work.error !== undefined && answered && <li className="flex flex-wrap items-center gap-2 py-1 text-body"><I icon={Alert02Icon} size={12} className="text-fail" />{work.error}{onRetry && <RetryButton onRetry={onRetry} />}</li>}
      </ul></CollapsibleContent>
    </Collapsible>
    {work.calls.filter((call) => call.status === 'blocked').map((call) => <Blocked key={call.id} agent={agent} call={call} />)}
  </>
}

function Mark({ call, size = 14 }: { call: ToolCall; size?: number }) {
  const connection = useConnections().data?.find((each) => each.id === call.connectionId)
  if (connection) return <Glyph name={connectionBrand(connection)} size={size} />
  return <span className="grid shrink-0 place-items-center text-mute">{STEP_ICONS[kindOf(call.tool)]}</span>
}

const STATUS = { failed: ['Failed', Alert02Icon, 'text-fail'], blocked: ['Blocked', SquareLock02Icon, 'text-fail'], asked: ['Waiting for you', UserIcon, 'text-ink'] } as const

function Row({ call }: { call: ToolCall }) {
  const status = call.status === 'failed' || call.status === 'blocked' || call.status === 'asked' ? STATUS[call.status] : undefined
  const hint = call.input && hintOf(call.input)
  const head = <span className="flex min-w-0 items-center gap-2">
    <Mark call={call} />
    <span className={cn('shrink-0', status ? 'text-ink' : 'text-body')}>{labelOf(call)}</span>
    {hint && <span className="min-w-0 truncate font-mono text-[11.5px] text-mute-2">{hint}</span>}
    {call.status === 'running' && <Spinner className="mt-0 size-3 shrink-0" />}
    {status && <span className={cn('inline-flex shrink-0 items-center gap-1', status[2])}><I icon={status[1]} size={12} />{status[0]}</span>}
  </span>
  const error = call.status === 'failed' && call.error && <p className="m-0 pt-1 pl-[22px] text-body">{call.error}</p>
  if (!call.input && !call.output) return <li className="py-1">{head}{error}</li>
  return <li className="py-0.5"><Collapsible>
    <CollapsibleTrigger className="group/row -ml-1 flex w-full min-w-0 cursor-pointer items-center rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-inherit hover:bg-tint">{head}<I icon={ArrowRight01Icon} size={11} className="ml-1.5 shrink-0 text-mute-2 opacity-0 group-hover/row:opacity-100 group-data-panel-open/row:rotate-90 group-data-panel-open/row:opacity-100" /></CollapsibleTrigger>
    {error}
    <CollapsibleContent><div className="mt-1.5 mb-1 ml-[22px] flex flex-col gap-1.5">
      {call.input && <Detail title="Input" text={call.input} />}
      {call.output && <Detail title="Output" text={call.output} />}
    </div></CollapsibleContent>
  </Collapsible></li>
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Button type="button" variant="secondary" className={PILL} onClick={onRetry}>Retry</Button>
}

function labelOf(call: ToolCall) {
  if (call.status === 'running') return `${call.label}…`
  return call.status === 'done' ? call.past : call.label
}

function hintOf(input: string) {
  const value = /^\s*\{\s*"[^"]+":\s*"((?:[^"\\]|\\.)*)"/.exec(input)?.[1]
  return (value ?? input).split('\n').find((line) => line.trim())?.trim()
}

function Detail({ title, text }: { title: string; text: string }) {
  const lines = text.split('\n')
  return <div className="flex flex-col gap-1">
    <span className="text-[11.5px] text-mute-2">{title}</span>
    <pre className="m-0 overflow-hidden rounded-lg bg-sidebar px-2.5 py-2 font-mono text-[11.5px]/[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap text-body">{lines.slice(0, 5).join('\n')}{lines.length > 5 && <span className="block text-mute-2">+{lines.length - 5} more lines</span>}</pre>
  </div>
}

function Blocked({ agent, call }: { agent: Agent; call: ToolCall }) {
  const connectionId = call.connectionId
  return <div className="flex max-w-[560px] min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-sidebar px-3.5 py-2.5">
    <Mark call={call} size={18} />
    <span className="min-w-0 flex-1 text-[13px] text-ink">{connectionId ? `${call.label} is set to Never` : call.error}</span>
    {connectionId && <span className="flex shrink-0 gap-1.5">
      {call.kind === 'read' && agent.canEdit && <AllowReads agent={agent} connectionId={connectionId} app={call.app ?? 'the app'} />}
      <Button type="button" variant="ghost" className={PILL} onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'apps', detail: connectionId }))}>Change permission</Button>
    </span>}
  </div>
}

function AllowReads({ agent, connectionId, app }: { agent: Agent; connectionId: string; app: string }) {
  const tools = useAgentTools({ agentId: agent.id, connectionId })
  const set = useSetToolPermission()
  const reads = tools.data?.filter((tool) => tool.group === 'read').map((tool) => tool.name) ?? []
  const allow = () => set.mutate({ agentId: agent.id, connectionId, tools: reads, permission: 'allow' }, { onSuccess: () => toast(`${agent.name} may read ${app} now. Ask again.`), onError: toastError })
  return <Button type="button" variant="secondary" className={PILL} disabled={!reads.length || set.isPending} onClick={allow}>Allow reads</Button>
}
