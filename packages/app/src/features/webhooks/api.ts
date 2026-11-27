import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import * as z from 'zod/mini'
import { Webhook as BaseWebhook, type CreateWebhook, type UpdateWebhook } from '@openhut/common/webhooks/webhook.ts'
import { Place } from '@openhut/common/channels/channel.ts'
import { request } from '@/lib/api-client'
import { CallCard } from '@/features/webhooks/call'

export const Webhook = z.extend(BaseWebhook, {
  channel: z.optional(z.union([z.literal('app'), Place])),
  preview: z.optional(z.nullable(CallCard)),
  filter: z.optional(z.nullable(z.string())),
  skipped: z.optional(z.number()),
})
export type Webhook = z.infer<typeof Webhook>

const WEBHOOK_LIST = List(Webhook)
const DELETED_WEBHOOK = Deleted('webhook')

export const webhooksKey = (agentId: string) => ['webhooks', agentId]

export function useWebhooks(agentId: string, enabled = true) {
  return useQuery({
    queryKey: webhooksKey(agentId),
    enabled,
    queryFn: () => request({ schema: WEBHOOK_LIST, of: agentId, path: `/api/webhooks?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}

function useWebhookMutation<T>({ agentId, send }: { agentId: string; send: (input: T) => Promise<Webhook> }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (webhook) => client.setQueryData<Webhook[]>(webhooksKey(agentId), (all) => all?.some((each) => each.id === webhook.id) ? all.map((each) => each.id === webhook.id ? webhook : each) : [...all ?? [], webhook]),
  })
}

export const useCreateWebhook = (agentId: string) => useWebhookMutation({ agentId, send: (body: Omit<CreateWebhook, 'agentId'>) => request({ schema: Webhook, of: agentId, path: '/api/webhooks', method: 'POST', body: { ...body, agentId } }) })

export const useUpdateWebhook = (agentId: string) => useWebhookMutation({ agentId, send: ({ id, ...body }: { id: string } & UpdateWebhook & { channel?: Place | 'app' }) => request({ schema: Webhook, of: agentId, path: `/api/webhooks/${encodeURIComponent(id)}`, method: 'PATCH', body }) })

export const useRotateWebhook = (agentId: string) => useWebhookMutation({ agentId, send: (id: string) => request({ schema: Webhook, of: agentId, path: `/api/webhooks/${encodeURIComponent(id)}/rotations`, method: 'POST' }) })

export function useDeleteWebhook(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request({ schema: DELETED_WEBHOOK, of: agentId, path: `/api/webhooks/${encodeURIComponent(id)}`, method: 'DELETE' }),
    onSuccess: (gone) => client.setQueryData<Webhook[]>(webhooksKey(agentId), (all) => all?.filter((each) => each.id !== gone.id)),
  })
}
