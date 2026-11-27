import { useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import * as z from 'zod/mini'
import { Webhook as BaseWebhook } from '@openhut/common/webhooks/webhook.ts'
import { Place } from '@openhut/common/channels/channel.ts'
import { request } from '@/lib/api-client'
import { webhooksKey } from '@/lib/query-keys'
import { CallCard } from '@/lib/webhook-call'

export const Webhook = z.extend(BaseWebhook, {
  channel: z.optional(z.union([z.literal('app'), Place])),
  preview: z.optional(z.nullable(CallCard)),
  filter: z.optional(z.nullable(z.string())),
  skipped: z.optional(z.number()),
})
export type Webhook = z.infer<typeof Webhook>

const WEBHOOK_LIST = List(Webhook)

export function useWebhooks(agentId: string, enabled = true) {
  return useQuery({
    queryKey: webhooksKey(agentId),
    enabled,
    queryFn: () => request({ schema: WEBHOOK_LIST, of: agentId, path: `/api/webhooks?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}
