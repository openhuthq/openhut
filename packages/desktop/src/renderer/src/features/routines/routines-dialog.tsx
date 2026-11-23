import { ArrowRight01Icon, Cancel01Icon, CancelCircleIcon, CircleIcon, Clock01Icon, Loading02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Routine } from '@openhut/common/routines/routine.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { useConfirming } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { DialogCard, I, Loading, ROW, ROW_VALUE, SPLIT_DIALOG } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { Face } from '@/features/agents/face'
import { useRoutines, useStopRoutine } from '@/features/routines/api'
import { dateOf, dayOf, nextOf, onceOf, scheduleOf, timeOf } from '@/features/routines/when'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const GLYPHS = ['slack', 'whatsapp', 'telegram', 'discord'] as const

export function RoutinesRow({ agent }: { agent: Agent }) {
  const routines = useRoutines(agent.id).data
  const stopped = routines?.filter((each) => each.stopped).length ?? 0
  const active = (routines?.length ?? 0) - stopped
  return <a className={ROW} href={agentPath({ agentId: agent.id, dialog: 'routines' })}><I icon={Clock01Icon} size={15} className="text-mute" />Routines<span className={ROW_VALUE}>
    {routines && (active || stopped ? active : 'None yet')}
    {stopped > 0 && <><span className="text-mute">·</span><i className="size-1.5 rounded-full bg-fail" />{stopped} stopped</>}
    <I icon={ArrowRight01Icon} size={12} className="text-mute" />
  </span></a>
}

export function RoutinesDialog({ agent, open, onClose }: { agent: Agent; open: string | undefined; onClose: () => void }) {
  const routines = useRoutines(agent.id)
  return <DialogCard onClose={onClose} className={cn(SPLIT_DIALOG, 'flex-col')}>
    <div className="flex items-center gap-3 border-b border-hair px-5 py-3">
      <Face agent={agent} size={40} />
      <DialogTitle className="min-w-0 flex-1 text-[15px]/[22px] font-medium">{agent.name}'s routines</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mr-1" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <ErrorNote className="mx-5 mt-3" message={routines.error?.message} />
    {!routines.data && !routines.error && <Loading />}
    {routines.data && (routines.data.length ? <Split agent={agent} routines={routines.data} open={open} /> : <Empty agent={agent} />)}
  </DialogCard>
}

function Split({ agent, routines, open }: { agent: Agent; routines: Routine[]; open: string | undefined }) {
  const picked = routines.find((each) => each.id === open) ?? routines[0]
  const now = new Date()
  return <div className="flex min-h-0 flex-1">
    <nav aria-label="Routines" className="flex w-[340px] shrink-0 flex-col gap-0.5 overflow-auto border-r border-hair bg-sidebar p-4">
      {routines.map((each) => <a key={each.id} href={agentPath({ agentId: agent.id, dialog: 'routines', detail: each.id })} aria-current={each.id === picked.id || undefined}
        className="flex gap-2.5 rounded-lg px-2 py-2 text-ink no-underline hover:bg-hover aria-[current]:bg-picked">
        <StatusCircle routine={each} />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[13px]/[18px]">{each.name}</span>
          <span className="truncate text-[12px]/[16px] text-mute">{lineOf({ routine: each, now })}</span>
        </span>
      </a>)}
    </nav>
    <Detail key={picked.id} agent={agent} routine={picked} now={now} />
  </div>
}

function Detail({ agent, routine, now }: { agent: Agent; routine: Routine; now: Date }) {
  const { confirming, setConfirming, box } = useConfirming()
  const stop = useStopRoutine(agent.id)
  const action = routine.stopped ? 'Clear' : 'Stop'
  return <section className="flex min-w-0 flex-1 flex-col">
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-7 pt-6 pb-8">
      <div className="grid gap-1.5">
        <h2 className="m-0 text-[18px]/[1.3] font-semibold text-balance">{routine.name}</h2>
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-[13px] text-body">
          <span>{routine.stopped ?? whenOf(routine)}</span><span className="text-mute-2">·</span>
          <span className="inline-flex items-center gap-1">{GLYPHS.find((each) => each === routine.platform) && <Glyph name={routine.platform as typeof GLYPHS[number]} size={13} />}{routine.place}</span>
          {routine.until && !routine.stopped && <><span className="text-mute-2">·</span><span>until {dateOf(new Date(routine.until))}</span></>}
        </p>
      </div>
      <div className="flex gap-3">
        <Face agent={agent} size={28} className="mt-0.5 shrink-0" />
        <p className="m-0 max-w-[60ch] text-[14px]/[1.6] whitespace-pre-wrap text-ink">{routine.plan}</p>
      </div>
      {routine.last && <div className="ml-10 grid gap-1">
        <span className="text-[12px] text-mute">Last time · {dayOf({ at: new Date(routine.last.at), now })}, {timeOf(new Date(routine.last.at))}</span>
        <p className="m-0 flex max-w-[60ch] gap-1.5 text-[14px]/[1.6] whitespace-pre-wrap text-ink">
          {routine.last.status === 'failed' && <I icon={CancelCircleIcon} size={15} className="mt-[3px] shrink-0 text-fail" />}
          {saidOf(routine.last)}
        </p>
      </div>}
    </div>
    <div ref={box} className="flex items-center gap-2 border-t border-hair px-5 py-3">
      {confirming
        ? <><span className="text-[13px]">{routine.stopped ? 'Takes it off the list.' : `${agent.name} won't run it again.`}</span>
          <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" variant="danger" disabled={stop.isPending || !agent.canEdit} onClick={() => stop.mutate(routine.id, { onSuccess: () => navigate(agentPath({ agentId: agent.id, dialog: 'routines' }), true), onError: toastError })}>{action}</Button></span></>
        : <>
          <span className="text-[13px] text-body">{routine.stopped ? 'Want it running again?' : 'Want it different?'} <Button type="button" variant="link" onClick={() => navigate(agentPath({ agentId: agent.id }))}>Tell {agent.name}</Button>.</span>
          {agent.canEdit && <Button type="button" variant="danger" className="ml-auto" onClick={() => setConfirming(true)}>{action}</Button>}
        </>}
    </div>
  </section>
}

function StatusCircle({ routine }: { routine: Routine }) {
  if (routine.last?.status === 'open') return <I icon={Loading02Icon} size={15} className="mt-0.5 animate-spin text-hue-amber" />
  if (routine.stopped || routine.last?.status === 'failed') return <I icon={CancelCircleIcon} size={15} className="mt-0.5 text-fail" />
  return <I icon={CircleIcon} size={15} className="mt-0.5 text-mute-2" />
}

function lineOf({ routine, now }: { routine: Routine; now: Date }): string {
  if (routine.stopped) return routine.stopped
  if (routine.last?.status === 'open') return 'Running now'
  if (routine.last?.status === 'failed') return 'Last run failed'
  return routine.nextRunAt ? nextOf({ at: new Date(routine.nextRunAt), now }) : 'Running now'
}

function whenOf(routine: Routine): string {
  if (routine.cron) return scheduleOf(routine.cron)
  return routine.at ? onceOf(new Date(routine.at)) : ''
}

function saidOf(last: NonNullable<Routine['last']>): string {
  if (last.status === 'quiet') return 'Nothing new.'
  if (last.status === 'open') return 'Running now…'
  return last.text ?? ''
}

function Empty({ agent }: { agent: Agent }) {
  return <div className="grid flex-1 place-items-center p-8">
    <div className="grid max-w-[400px] justify-items-center gap-2 text-center">
      <Face agent={agent} size={56} />
      <h2 className="m-0 mt-2 text-[20px] font-semibold">No routines yet</h2>
      <p className="m-0 text-[14px]/[1.55] text-body">{agent.name} adds routines here when something needs a follow-up.</p>
    </div>
  </div>
}
