import { Activity01Icon, AlertCircleIcon, ArrowRight01Icon, Cancel01Icon, CancelCircleIcon, CheckmarkCircle02Icon, HourglassIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons'
import type { ConnectionEvent } from '@openhut/common/connections/connection.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { DialogCard, I, Loading, ROW, ROW_VALUE } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { Quiet } from '@/features/agents/request-card'
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

function outcomeOf(event: ConnectionEvent) {
  if (!event.approvedBy) return OUTCOMES[event.outcome]
  if (event.outcome === 'denied') return { ...OUTCOMES.denied, word: `${event.approvedBy} said no` }
  return { icon: SecurityCheckIcon, hue: 'text-hue-amber', word: `${event.approvedBy} said yes${event.outcome === 'failed' ? ', then it failed' : ''}` }
}

export function ActivityRow({ agent }: { agent: Agent }) {
  return <a className={ROW} href={agentPath({ agentId: agent.id, dialog: 'activity' })}><I icon={Activity01Icon} size={15} className="text-hue-green" />Activity<span className={ROW_VALUE}><I icon={ArrowRight01Icon} size={12} className="text-mute" /></span></a>
}

export function ActivityDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const events = useAgentEvents(agent.id)
  const connections = useConnections().data ?? []
  return <DialogCard onClose={onClose} className="max-h-[min(640px,calc(100vh-48px))] w-[540px] gap-0 overflow-hidden p-0">
    <div className="flex items-center gap-3 px-6 pt-6 pb-4">
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">What {agent.name} did</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-2" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6">
      <ErrorNote message={events.error?.message} />
      {!events.data && !events.error && <Loading />}
      {events.data && (events.data.length
        ? <div className="flex flex-col gap-0.5">{events.data.map((event) => {
          const connection = connections.find((each) => each.id === event.connectionId)
          const outcome = outcomeOf(event)
          const tool = connection ? event.tool.replace(`${connection.kind}_`, '') : event.tool
          return <div key={event.id} className="flex min-h-11 min-w-0 items-center gap-3">
            <span className="grid shrink-0" title={outcome.word}><I icon={outcome.icon} size={17} className={outcome.hue} /></span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink" title={`${event.tool}: ${event.reason}`}>{event.outcome === 'denied' && !event.approvedBy ? `Tried to ${toolLabel(tool, 'now')}` : toolLabel(tool)}</span>
            {connection && <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-mute"><Glyph name={connectionBrand(connection)} size={13} />{connection.name}</span>}
            <span className="w-14 shrink-0 text-right text-[12px] text-mute">{ago(event.at)} ago</span>
          </div>
        })}</div>
        : <Quiet agent={agent} line={`All quiet. ${agent.name} hasn't used any apps yet.`} />)}
    </div>
  </DialogCard>
}
