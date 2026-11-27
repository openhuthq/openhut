import { AlertCircleIcon, CancelCircleIcon, CheckmarkCircle02Icon, HourglassIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons'
import type { ConnectionEvent } from '@openhut/common/connections/connection.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, Loading } from '@/components/kit'
import { EmptyScene } from '@/components/empty-art'
import { connectionBrand } from '@/features/connections/catalog'
import { useAgentEvents, useConnections } from '@/features/connections/api'
import { ago } from '@/lib/format'
import { toolLabel } from '@/lib/tool-label'

const OUTCOMES = {
  allowed: { icon: CheckmarkCircle02Icon, hue: 'text-hue-green', word: 'Done' },
  asked: { icon: HourglassIcon, hue: 'text-mute', word: 'Asked for your OK' },
  denied: { icon: CancelCircleIcon, hue: 'text-hue-red', word: 'Not allowed' },
  failed: { icon: AlertCircleIcon, hue: 'text-hue-amber', word: 'Failed' },
}

function sentenceOf({ outcome, tool }: { outcome: ConnectionEvent['outcome']; tool: string }) {
  if (outcome === 'allowed') return toolLabel(tool)
  return `${outcome === 'asked' ? 'Asked to' : 'Tried to'} ${toolLabel(tool, 'now')}`
}

function outcomeOf(event: ConnectionEvent) {
  if (!event.approvedBy) return OUTCOMES[event.outcome]
  if (event.outcome === 'denied') return { ...OUTCOMES.denied, word: `${event.approvedBy} said no` }
  return { icon: SecurityCheckIcon, hue: 'text-hue-amber', word: `${event.approvedBy} said yes${event.outcome === 'failed' ? ', then it failed' : ''}` }
}

export function ActivityList({ agent }: { agent: Agent }) {
  const events = useAgentEvents(agent.id)
  const connections = useConnections().data ?? []
  return <>
      <ErrorNote message={events.error?.message} />
      {!events.data && !events.error && <Loading />}
      {events.data && (events.data.length
        ? <div className="flex flex-col gap-0.5">{events.data.map((event) => {
          const connection = connections.find((each) => each.id === event.connectionId)
          const outcome = outcomeOf(event)
          const tool = connection ? event.tool.replace(`${connection.kind}_`, '') : event.tool
          return <div key={event.id} className="flex min-h-11 min-w-0 items-center gap-3">
            <span className="grid shrink-0" title={outcome.word}><I icon={outcome.icon} size={17} className={outcome.hue} /></span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink" title={`${event.tool}: ${event.reason}`}>{sentenceOf({ outcome: event.outcome, tool })}</span>
            {connection && <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-mute"><Glyph name={connectionBrand(connection)} size={13} />{connection.name}</span>}
            <span className="w-14 shrink-0 text-right text-[12px] text-mute">{ago(event.at)} ago</span>
          </div>
        })}</div>
        : <EmptyScene kind="activity" title="All quiet" line={`${agent.name} hasn\u2019t used your apps yet. Everything it does shows up here.`} />)}
  </>
}
