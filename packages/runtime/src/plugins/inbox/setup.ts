import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod'
import { APP_PLATFORM, defineTool } from '../../core/plugin.ts'
import { inboxService } from '../../server/inbox/inbox-service.ts'
import { Origin } from '../../server/inbox/routines.ts'
import { who } from '../../server/team/identity.ts'

const KEPT_MS = 60 * 60_000
const shown = new Map<string, { at: number; card: SetupCard }>()

type SetupCard = { webhookId: string; title: string; steps: string[]; openUrl?: string }

export const showWebhookSetup = defineTool({
  description: 'Show a person how to set up one of your webhooks in another service, like a DigitalOcean alert. In the OpenHut app it shows a card with the real address and a copyable secret; elsewhere it gives you the text to send.',
  input: {
    webhookId: z.string().max(40).describe('The webhook\'s id, like wh_ab12cd34.'),
    title: z.string().trim().min(1).max(120).describe('What they\'re setting up: "Send DigitalOcean alerts to Database Police".'),
    steps: z.array(z.string().trim().min(1).max(300)).min(1).max(12).describe('Each step in plain words. Don\'t put the address or secret in them.'),
    openUrl: z.url({ protocol: /^https$/ }).max(500).optional().describe('The page in the other service where they start, if you know it.'),
  },
  run: async ({ webhookId, title, steps, openUrl }, { agent, origin }) => {
    const hook = await inboxService.ownWebhook({ agentId: agent.id, id: webhookId })
    if (Origin.safeParse(origin).data?.platform === APP_PLATFORM) {
      shown.set(agent.id, { at: Date.now(), card: { webhookId: hook.id, title, steps, ...openUrl && { openUrl } } })
      return 'The setup card is in the chat, with the address and the secret. Don\'t repeat them; add anything else in a line or two.'
    }
    return [`Send this as it is:`, '', title, ...steps.map((step, index) => `${index + 1}. ${step}`), ...openUrl ? [`Start here: ${openUrl}`] : [], `Address: ${hook.address}`, 'Secret: copy it from OpenHut, on the webhook\'s page.'].join('\n')
  },
})

export function setupCard({ agentId, since }: { agentId: string; since: Date }): { type: 'data-webhook-setup'; data: SetupCard } | undefined {
  const held = shown.get(agentId)
  if (!held || Date.now() - held.at > KEPT_MS || held.at < since.getTime()) return undefined
  shown.delete(agentId)
  return { type: 'data-webhook-setup', data: held.card }
}

export const setupController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:webhookId/setup', { schema: { params: z.object({ id: z.string(), webhookId: z.string() }) } }, async (req) => inboxService.setup({ actor: await who(req), agentId: req.params.id, id: req.params.webhookId }))
}
