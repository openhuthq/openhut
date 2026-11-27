import * as z from 'zod'
import { WebhookThreads } from '@openhut/common/webhooks/webhook.ts'
import { defineAsk, definePlugin, defineTool } from '../../core/plugin.ts'
import { routineService } from '../../server/inbox/routines.ts'
import { inboxService, urlOf } from '../../server/inbox/inbox-service.ts'
import { deliveryTargetController, inboxReceiver, routineController, webhookController } from '../../server/inbox/inbox-controller.ts'
import { createTables } from './tables.ts'
import { WEBHOOK_SETUP_PROMPT } from '@openhut/common/webhooks/webhook.ts'
import { setupCard, setupController, showWebhookSetup } from './setup.ts'

const FUNCTION = z.string().max(2000)
const THREADS = z.enum(WebhookThreads.options).describe('group (the default) keeps related calls in one thread: alerts, CI runs, pull requests, reports. each starts a new thread per call: forms, orders, signups.')

export const inbox = definePlugin({
  name: 'inbox',
  migrate: createTables,
  routes: () => ({ '/api/routines': routineController, '/api/webhooks': webhookController, '/api/delivery-targets': deliveryTargetController, '/inbox': inboxReceiver, '/api/agents/:id/webhooks': setupController }),
  start: () => inboxService.start(),
  agent: () => ({ instructions: WEBHOOK_SETUP_PROMPT }),
  afterTurn: async (input) => setupCard(input),
  tools: {
    show_webhook_setup: showWebhookSetup,
    schedule_routine: defineTool({
      description: 'Use this whenever something needs a follow-up later: a promise you made, a reply you\'re waiting on, a date someone mentioned. Don\'t wait to be asked. Then tell the person in one line what you set up. Check list_routines first, and don\'t set up the same follow-up twice. Each run starts in the chat where you call this, with that chat\'s history. To change a routine you have (its plan, name or timing), pass replaces with its id instead of cancelling it and making a new one: it keeps its id, where it posts and the owner\'s end date.',
      input: {
        name: z.string().min(1).max(80).describe('Starts with a verb, plain words: "Chase Acme on invoice #4471".'),
        plan: z.string().min(1).max(2000).describe('Written to yourself: what to check, when to speak up, when to stop.'),
        at: z.string().max(40).optional().describe('ISO time with an offset, for a one-time routine, like 2026-11-28T09:00:00+01:00.'),
        cron: z.string().max(100).optional().describe('Minute hour day month weekday, in the owner\'s time zone, for a repeating one, like 0 10 * * 1-5. At most every 15 minutes.'),
        until: z.string().max(40).optional().describe('ISO time; a repeating routine stops then. At most 90 days ahead, the default.'),
        replaces: z.string().max(40).optional().describe('The id of your routine this one replaces, like rt_ab12cd34. It changes in place.'),
      },
      run: (input, { agent, origin }) => routineService.schedule({ agentId: agent.id, input: { ...input, origin } }),
    }),
    set_webhook_threads: defineTool({
      description: 'Set how one of your webhooks handles its calls, with plain JavaScript functions of the payload (p => …) written from what its payloads look like. threads: group keeps related calls in one thread (alerts and their recovery, CI runs, pull requests); each starts a new thread per call (forms, orders, signups). An empty string clears a function. The reply tries all four on the last call.',
      input: {
        id: z.string().max(40).describe('The webhook\'s id, like wh_ab12cd34.'),
        threads: THREADS.optional(),
        filter: FUNCTION.optional().describe('Truthy keeps a call; the rest are counted as skipped and never wake you: p => p.action === "completed".'),
        fingerprint: FUNCTION.optional().describe('A string; calls with the same one are one event, counted as seen again instead of waking you: p => `${p.workflow_run.id}/${p.workflow_run.run_attempt}`. The default is the delivery id, else the body.'),
        thread: FUNCTION.optional().describe('A string; calls with the same one share a thread: DigitalOcean p => `${p.subject}/${p.data.alert_rule_name}`. Leave it empty to keep every call in one thread.'),
        card: FUNCTION.optional().describe('What a call shows as: p => ({ title, status, details, link, icon }). title also names a new thread; icon is a simple-icons slug like "github" or "digitalocean".'),
      },
      run: (input, { agent }) => inboxService.setThreads({ agentId: agent.id, ...input }),
    }),
    list_routines: defineTool({ description: 'List your routines, one line each.', input: {}, run: (_, { agent }) => routineService.listForAgent({ agentId: agent.id }) }),
    run_routine: defineTool({
      description: 'Run one of your routines now, to check it works after you set it up. Its schedule stays the same. The run reaches you as a new turn where the routine posts.',
      input: { id: z.string().max(40).describe('The routine\'s id, like rt_ab12cd34.') },
      run: async ({ id }, { agent }) => {
        await inboxService.runRoutine({ agentId: agent.id, id })
        return 'Started. Finish this reply; the run comes next.'
      },
    }),
    cancel_routine: defineTool({
      description: 'Use this when what you were following up on is done, or no longer needed. Tell the chat first: the routine leaves the owner\'s list.',
      input: { id: z.string().max(40), reason: z.string().max(200).describe('Short, past tense, for the log: "Paid on Nov 26".') },
      run: ({ id, reason }, { agent }) => routineService.cancel({ agentId: agent.id, id, reason }),
    }),
  },
  asks: {
    add_webhook: defineAsk({
      input: z.object({ name: z.string().trim().min(1).max(60).describe('What calls it, in a few words: "DigitalOcean Postgres alerts".'), threads: THREADS.optional() }),
      tool: 'Ask for a webhook: an address another service (like DigitalOcean alerts) calls when something happens. Each call reaches you in an OpenHut thread with the raw payload; with threads group (the default) related calls share one, with each every call gets its own; to tell people about it, use notify. Once approved, call show_webhook_setup to show the person how to set it up.',
      title: ({ input }) => `Add a webhook named ${input.name}`,
      run: async ({ actor, ask: { agentId, input } }) => {
        const { id } = await inboxService.createSource({ actor, agentId, name: input.name, threads: input.threads })
        return `Its address is ${urlOf(id)}. ${input.threads === 'each' ? 'Each call starts a new thread' : 'Related calls share a thread'} in OpenHut. Now call show_webhook_setup with ${id} so the person gets the address and secret to paste into the sender (DigitalOcean: a webhook notification channel signed with that secret).`
      },
    }),
  },
  wakes: {
    due: ({ agentId }) => inboxService.due({ agentId }),
    picked: ({ agentId, id }) => inboxService.picked({ agentId, id }),
    said: async ({ agentId, id, reply }) => { if (id.startsWith('ru_')) await inboxService.report({ agentId, runId: id, said: reply }) },
  },
})
