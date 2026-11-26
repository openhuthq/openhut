import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { agentPath } from '@/app/routes'
import type { AskExtra } from '@/features/asks/custom'
import { lineDiff, needsQrScan, undoable } from '@/features/asks/extras'
import { navigate } from '@/lib/router'

const InstructionsDiff: AskExtra = ({ agent, ask }) => {
  const after = ask.input.instructions
  if (ask.status !== 'open' || typeof after !== 'string') return null
  return <div className="flex max-h-64 flex-col overflow-y-auto text-[13px]/[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]" data-diff>
    {lineDiff({ before: agent.instructions, after }).map((line, index) => {
      if (line.kind === 'gone') return <span key={index} className="text-mute line-through">{line.text}</span>
      if (line.kind === 'added') return <span key={index} className="text-ink"><span className="text-hue-green">+ </span>{line.text}</span>
      return <span key={index} className="text-body">{line.text || ' '}</span>
    })}
  </div>
}

const ScanQr: AskExtra = ({ agent, ask }) => {
  if (!needsQrScan(ask) || !agent.canEdit) return null
  return <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'whatsapp' }))}>Scan the QR code</Button>
}

const CantUndo: AskExtra = ({ ask }) => {
  if (!undoable(ask)) return null
  return <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><I icon={AlertCircleIcon} size={14} className="text-hue-red" />This can't be undone.</span>
}

export const extras = { update_self: InstructionsDiff, add_channel: ScanQr, call_tool: CantUndo }
