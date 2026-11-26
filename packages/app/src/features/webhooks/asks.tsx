import { CopyButton } from '@/components/copy-button'
import { Details } from '@/features/agents/request-card'
import type { AskExtra } from '@/features/asks/custom'
import { webhookOf } from '@/features/asks/extras'
import { useWebhooks } from '@/features/webhooks/api'

const AddressAndSecret: AskExtra = ({ agent, ask }) => {
  const webhooks = useWebhooks(agent.id, agent.canEdit && ask.status === 'done').data ?? []
  const webhook = webhookOf({ ask, webhooks })
  if (!webhook) return null
  return <Details label="Get the address and secret">
    {[['Address', webhook.url], ['Secret', webhook.secret]].map(([label, value]) => <div key={label} className="flex min-h-8 min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 text-mute">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={value}>{value}</code>
      <CopyButton text={value} label="Copy" variant="ghost" />
    </div>)}
  </Details>
}

export const extras = { add_webhook: AddressAndSecret }
