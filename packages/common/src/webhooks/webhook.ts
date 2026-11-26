import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const WEBHOOK_NAME_MAX = 60

export const Webhook = z.object({
  id: z.string(),
  object: z.literal('webhook'),
  agentId: z.string(),
  name: z.string(),
  url: z.string(),
  secret: z.string(),
  platform: z.string(),
  target: z.string(),
  place: z.string(),
  lastAt: z.nullable(Timestamp),
  lastPayload: z.nullable(z.string()),
  createdAt: Timestamp,
})
export type Webhook = z.infer<typeof Webhook>

export const DeliveryTarget = z.object({ id: z.string(), object: z.literal('delivery_target'), platform: z.string(), place: z.string() })
export type DeliveryTarget = z.infer<typeof DeliveryTarget>

export const WebhookName = z.string().check(z.trim(), z.minLength(1), z.maxLength(WEBHOOK_NAME_MAX))

export const ListWebhooks = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListWebhooks = z.infer<typeof ListWebhooks>

export const CreateWebhook = z.object({ agentId: z.string().check(z.maxLength(40)), name: WebhookName, target: z.optional(z.string().check(z.maxLength(40))) })
export type CreateWebhook = z.infer<typeof CreateWebhook>

export const UpdateWebhook = z.object({ name: z.optional(WebhookName), target: z.optional(z.string().check(z.maxLength(40))) })
export type UpdateWebhook = z.infer<typeof UpdateWebhook>
