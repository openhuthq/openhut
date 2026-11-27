import type { Ask } from '@openhut/common/asks/ask.ts'
import { Button } from '@/components/ui/button'
import { Face } from '@/components/agent-face'
import { RequestCard, type Decided } from '@/components/request-card'
import { agentPath } from '@/config/paths'
import { lineDiff, needsQrScan, type AskExtra } from '@/lib/asks'
import { useAnswer } from '@/lib/queries/asks'
import { navigate } from '@/lib/router'

const DECIDED: Partial<Record<Ask['status'], Decided>> = {
  done: { label: 'Applied', tone: 'success' },
  undone: { label: 'Undone. Its name and instructions are back to how they were.', tone: 'secondary' },
}

function Diff({ before, after }: { before: string; after: string }) {
  return <div className="flex max-h-64 flex-col overflow-y-auto text-[13px]/[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]" data-diff>
    {lineDiff({ before, after }).map((line, index) => {
      if (line.kind === 'gone') return <span key={index} className="text-mute line-through">{line.text}</span>
      if (line.kind === 'added') return <span key={index} className="text-ink"><span className="text-hue-green">+ </span>{line.text}</span>
      return <span key={index} className="text-body">{line.text || ' '}</span>
    })}
  </div>
}

function beforeOf(ask: Ask): { name?: string; instructions?: string } {
  const before = ask.input.before
  return before && typeof before === 'object' ? before as { name?: string; instructions?: string } : {}
}

const SelfChange: AskExtra = ({ agent, ask }) => {
  const answer = useAnswer(agent.id)
  const before = beforeOf(ask)
  const open = ask.status === 'open'
  const name = typeof ask.input.name === 'string' ? ask.input.name : undefined
  const instructions = typeof ask.input.instructions === 'string' ? ask.input.instructions : undefined
  const pick = (verb: 'approvals' | 'declines' | 'undos') => answer.mutate({ id: ask.id, verb, body: {} })
  return <RequestCard agent={agent} change={ask} icon={<Face agent={agent} size={28} />} title={ask.title} error={answer.error?.message}
    decided={DECIDED[ask.status]}
    after={ask.status === 'done' && agent.canEdit && <Button type="button" variant="secondary" size="sm" disabled={answer.isPending} onClick={() => pick('undos')}>Undo</Button>}
    actions={<>
      <Button type="button" variant="primary" size="sm" disabled={answer.isPending} onClick={() => pick('approvals')}>Approve</Button>
      <Button type="button" variant="ghost" size="sm" disabled={answer.isPending} onClick={() => pick('declines')}>Not now</Button>
    </>}>
    {name !== undefined && <p className="m-0 text-[13px] text-body">{before.name ? <><span className="text-mute line-through">{before.name}</span> → </> : null}<span className="text-ink">{name}</span></p>}
    {instructions !== undefined && <Diff before={open ? agent.instructions : before.instructions ?? ''} after={instructions} />}
  </RequestCard>
}

const ScanQr: AskExtra = ({ agent, ask }) => {
  if (!needsQrScan(ask) || !agent.canEdit) return null
  return <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'whatsapp' }))}>Scan the QR code</Button>
}

export const extras = { add_channel: ScanQr }
export const cards = { update_self: SelfChange }
