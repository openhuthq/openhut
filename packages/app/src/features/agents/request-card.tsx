import type { ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'
import { ErrorNote } from '@/components/error-note'
import { I } from '@/components/kit'
import { Face } from '@/features/agents/face'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export type Decided = { label: string; tone: 'success' | 'secondary' }
export type Action = { icon: IconSvgElement; hue: string }

const DEFAULT_DECIDED: Record<Ask['status'], Decided | undefined> & { expired: Decided } = {
  open: undefined,
  done: { label: 'Approved', tone: 'success' },
  declined: { label: 'Not approved', tone: 'secondary' },
  expired: { label: 'Expired. No one answered in time.', tone: 'secondary' },
}

export const EXPIRED = DEFAULT_DECIDED.expired

export function RequestCard({ agent, change, icon, action, title, decided = DEFAULT_DECIDED[change.status], error, actions, children }: {
  agent: Agent; change: Ask; icon: ReactNode; action?: Action; title: ReactNode; decided?: Decided; error?: string; actions?: ReactNode; children?: ReactNode
}) {
  const pending = change.status === 'open'
  return <div className="flex max-w-[560px] min-w-0 flex-col gap-3.5 rounded-xl bg-sidebar p-4">
    <div className="flex min-w-0 items-start gap-3">
      <span className="relative grid size-8 shrink-0 place-items-center">{icon}
        {action && <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-sidebar"><I icon={action.icon} size={13} className={action.hue} /></span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px]/[20px] font-medium text-ink [&_b]:font-semibold">{title}</span>
        <span className="text-[13px] text-mute">{change.description}</span>
      </div>
    </div>
    {children}
    {change.note && <span className="text-[13px] text-mute">You said: {change.note}</span>}
    {!pending && decided && <Outcome decided={decided} />}
    {pending && (agent.canEdit ? actions && <div className="flex flex-wrap items-center gap-1">{actions}</div> : <span className="text-[13px] text-mute">Waiting for {agent.name}'s owner.</span>)}
    <ErrorNote message={error} />
  </div>
}

function Outcome({ decided }: { decided: Decided }) {
  if (decided.tone === 'secondary') return <span className="text-[13px] text-mute">{decided.label}</span>
  return <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><I icon={CheckmarkCircle02Icon} size={16} className="animate-[pop_.45s_cubic-bezier(.2,.8,.2,1)] text-hue-green" />{decided.label}</span>
}

export function Details({ label = 'Details', open, children }: { label?: string; open?: boolean; children: ReactNode }) {
  return <Collapsible defaultOpen={open} className="flex flex-col gap-2 text-[12.5px]">
    <CollapsibleTrigger className="group/details -ml-1 inline-flex w-fit cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0.5 text-mute hover:text-ink">{label}<span className="[transition:transform_.15s] group-data-panel-open/details:rotate-90">›</span></CollapsibleTrigger>
    <CollapsibleContent><div className="flex flex-col gap-1.5 pl-1 text-[12.5px]/[1.5] text-body [overflow-wrap:anywhere]">{children}</div></CollapsibleContent>
  </Collapsible>
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3"><span className="text-mute">{label}</span><span className="text-ink">{children}</span></div>
}

export function AppLine({ icon, name, line }: { icon: ReactNode; name: string; line?: string }) {
  return <span className="flex min-w-0 items-center gap-2 text-[13px]">{icon}<span className="min-w-0 truncate"><span className="text-ink">{name}</span>{line && <span className="text-mute"> — {line}</span>}</span></span>
}

export function Quiet({ agent, line }: { agent: Agent; line: string }) {
  return <div className="flex flex-col items-center gap-3 py-8 text-center"><Face agent={agent} size={44} /><p className="m-0 max-w-[300px] text-[13.5px]/[1.5] text-balance text-body">{line}</p></div>
}
