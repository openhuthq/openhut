import { Button } from '@/components/ui/button'
import { agentPath } from '@/config/paths'
import { lineDiff, needsQrScan, type AskExtra } from '@/lib/asks'
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

export const extras = { update_self: InstructionsDiff, add_channel: ScanQr }
