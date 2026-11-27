import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { Place } from '../channels/channel.ts'

export const WebhookChannel = z.union([z.literal('app'), Place])
export type WebhookChannel = z.infer<typeof WebhookChannel>

export const WEBHOOK_NAME_MAX = 60

export const WebhookThreads = z.enum(['group', 'each'])
export type WebhookThreads = z.infer<typeof WebhookThreads>

export const WebhookCard = z.object({
  title: z.string(),
  status: z.optional(z.string()),
  details: z.optional(z.string()),
  link: z.optional(z.string()),
  icon: z.optional(z.object({ path: z.string(), hex: z.string() })),
})
export type WebhookCard = z.infer<typeof WebhookCard>

export const WebhookCallRow = z.object({ status: z.optional(z.string()), details: z.optional(z.string()), at: Timestamp, seen: z.optional(z.number()) })
export type WebhookCallRow = z.infer<typeof WebhookCallRow>

export const WebhookCallMeta = z.object({ webhookId: z.string(), card: z.optional(WebhookCard), calls: z.optional(z.array(WebhookCallRow)), seen: z.optional(z.number()) })
export type WebhookCallMeta = z.infer<typeof WebhookCallMeta>

export const Webhook = z.object({
  id: z.string(),
  object: z.literal('webhook'),
  agentId: z.string(),
  name: z.string(),
  url: z.string(),
  secret: z.string(),
  channel: WebhookChannel,
  platform: z.string(),
  target: z.string(),
  place: z.string(),
  threads: WebhookThreads,
  lastAt: z.nullable(Timestamp),
  lastPayload: z.nullable(z.string()),
  preview: z.nullable(WebhookCard),
  filter: z.nullable(z.string()),
  skipped: z.number(),
  createdAt: Timestamp,
})
export type Webhook = z.infer<typeof Webhook>

export const DeliveryTarget = z.object({ id: z.string(), object: z.literal('delivery_target'), platform: z.string(), place: z.string() })
export type DeliveryTarget = z.infer<typeof DeliveryTarget>

export const WebhookName = z.string().check(z.trim(), z.minLength(1), z.maxLength(WEBHOOK_NAME_MAX))

export const ListWebhooks = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListWebhooks = z.infer<typeof ListWebhooks>

export const CreateWebhook = z.object({ agentId: z.string().check(z.maxLength(40)), name: WebhookName, channel: z.optional(WebhookChannel), target: z.optional(z.string().check(z.maxLength(40))) })
export type CreateWebhook = z.infer<typeof CreateWebhook>

export const UpdateWebhook = z.object({ name: z.optional(WebhookName), channel: z.optional(WebhookChannel), target: z.optional(z.string().check(z.maxLength(40))), threads: z.optional(WebhookThreads) })
export type UpdateWebhook = z.infer<typeof UpdateWebhook>

export const WEBHOOK_SETUP_PROMPT = 'Whenever you ask a person to set up one of your webhooks in another service, call show_webhook_setup with the steps. Never type a webhook\'s address or secret into the chat yourself: the card shows the real ones.'
