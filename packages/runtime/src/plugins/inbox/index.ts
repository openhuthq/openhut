import * as z from 'zod'
import { defineAsk, definePlugin, defineTool } from '../../core/plugin.ts'
import { routineService } from '../../server/inbox/routines.ts'
import { inboxService, urlOf } from '../../server/inbox/inbox-service.ts'
import { deliveryTargetController, inboxReceiver, routineController, webhookController } from '../../server/inbox/inbox-controller.ts'
import { createTables } from './tables.ts'
import { WEBHOOK_SETUP_PROMPT } from '@openhut/common/webhooks/webhook.ts'
import { setupCard, setupController, showWebhookSetup } from './setup.ts'

export const inbox = definePlugin({
  name: 'inbox',
  migrate: createTables,
  routes: () => ({ '/api/routines': routineController, '/api/webhooks': webhookController, '/api/delivery-targets': deliveryTargetController, '/inbox': inboxReceiver, '/api/agents/:id/webhooks': setupController }),
  start: () => inboxService.start(),
  hermes: () => ({ prompt: WEBHOOK_SETUP_PROMPT }),
  afterTurn: async (input) => setupCard(input),
  tools: {
    show_webhook_setup: showWebhookSetup,
    schedule_routine: defineTool({
      description: 'Use this whenever something needs a follow-up later: a promise you made, a reply you\'re waiting on, a date someone mentioned. Don\'t wait to be asked. Then tell the person in one line what you set up. Check list_routines first, and don\'t set up the same follow-up twice. Each run starts in the chat where you call this, with that chat\'s history.',
      input: {
        name: z.string().min(1).max(80).describe('Starts with a verb, plain words: "Chase Acme on invoice #4471".'),
        plan: z.string().min(1).max(2000).describe('Written to yourself: what to check, when to speak up, when to stop.'),
        at: z.string().max(40).optional().describe('ISO time with an offset, for a one-time routine, like 2026-11-28T09:00:00+01:00.'),
        cron: z.string().max(100).optional().describe('Minute hour day month weekday, in the owner\'s time zone, for a repeating one, like 0 10 * * 1-5. At most every 15 minutes.'),
        until: z.string().max(40).optional().describe('ISO time; a repeating routine stops then. At most 90 days ahead, the default.'),
      },
      run: (input, { agent, origin }) => routineService.schedule({ agentId: agent.id, input: { ...input, origin } }),
    }),
    list_routines: defineTool({ description: 'List your routines, one line each.', input: {}, run: (_, { agent }) => routineService.listForAgent({ agentId: agent.id }) }),
    cancel_routine: defineTool({
      description: 'Use this when what you were following up on is done, or no longer needed. Tell the chat first: the routine leaves the owner\'s list.',
      input: { id: z.string().max(40), reason: z.string().max(200).describe('Short, past tense, for the log: "Paid on Nov 26".') },
      run: ({ id, reason }, { agent }) => routineService.cancel({ agentId: agent.id, id, reason }),
    }),
  },
  asks: {
    add_webhook: defineAsk({
      input: z.object({ name: z.string().trim().min(1).max(60).describe('What calls it, in a few words: "DigitalOcean Postgres alerts".') }),
      tool: 'Ask for a webhook: an address another service (like DigitalOcean alerts) calls when something happens. Each call starts a new chat in OpenHut with the raw payload; to tell people about it, use notify. Once approved, call show_webhook_setup to show the person how to set it up.',
      title: ({ input }) => `Add a webhook named ${input.name}`,
      run: async ({ actor, ask: { agentId, input } }) => {
        const { id } = await inboxService.createSource({ actor, agentId, name: input.name })
        return `Its address is ${urlOf(id)}. Each call starts a new chat in OpenHut. Now call show_webhook_setup with ${id} so the person gets the address and secret to paste into the sender (DigitalOcean: a webhook notification channel signed with that secret).`
      },
    }),
  },
  wakes: {
    due: ({ agentId }) => inboxService.due({ agentId }),
    picked: ({ agentId, id }) => inboxService.picked({ agentId, id }),
    said: async ({ agentId, id, reply }) => { if (id.startsWith('ru_')) await inboxService.report({ agentId, runId: id, said: reply }) },
  },
})
