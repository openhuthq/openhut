import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod'
import type { Place } from '@openhut/common/channels/channel.ts'
import { AgentNotify } from '@openhut/common/threads/thread.ts'
import { defineTool } from '../../core/plugin.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { placeService } from '../../server/channels/place-service.ts'
import { db } from '../../server/platform/db.ts'
import { emit, log } from '../../server/platform/events.ts'
import { HttpError } from '../../server/platform/http-error.ts'
import { IdParams } from '../../server/platform/responses.ts'
import { who } from '../../server/team/identity.ts'

const KEPT_MS = 60 * 60_000
const NONE: AgentNotify = { default: null, rules: '' }
const sent = new Map<string, { at: number; place: Place; text: string }[]>()

export const notifyTool = defineTool({
  description: 'Post a message for people to see when nobody is talking to you where it matters: a webhook alert, a routine\'s result, something your notify rules say to report. Leave place out to use your default place. Don\'t use it to answer the chat you\'re in.',
  input: {
    text: z.string().trim().min(1, 'Send the text to post.').max(4000).describe('What to post, in plain words.'),
    place: z.string().max(200).optional().describe('A channel name like #alerts, or its id. Leave out for your default place.'),
  },
  run: async ({ text, place }, { agent }) => {
    const places = await placeService.list({ agentId: agent.id })
    const wanted = place?.replace(/^#/, '').trim().toLowerCase()
    const to = wanted ? places.find((each) => each.chat_id === wanted || each.chat_name.replace(/^#/, '').toLowerCase() === wanted) : notifyOf((await db.selectFrom('agent').select('notify').where('id', '=', agent.id).executeTakeFirst())?.notify ?? null).default
    if (!to) return { text: `${wanted ? `You can't post in ${place}.` : 'You have no default place to notify.'} ${places.length ? `Pass place as one of: ${places.map((each) => each.chat_name).join(', ')}.` : 'You aren\'t connected to any channel you can post in.'}`, isError: true }
    await placeService.send({ agentId: agent.id, place: to, text })
    const kept = (sent.get(agent.id) ?? []).filter((each) => Date.now() - each.at < KEPT_MS)
    sent.set(agent.id, [...kept, { at: Date.now(), place: to, text }])
    log.info({ event: 'agent.notified', agent: agent.id, platform: to.platform })
    return `Posted in ${to.chat_name || to.platform}.`
  },
})

export function notified({ agentId, since }: { agentId: string; since: Date }): { type: 'data-notified'; data: { place: Place; text: string }[] } | undefined {
  const data = (sent.get(agentId) ?? []).filter((each) => each.at >= since.getTime()).map(({ place, text }) => ({ place, text }))
  return data.length ? { type: 'data-notified', data } : undefined
}

export function notifyPrompt(stored: string | null | undefined): string {
  const { default: place, rules } = notifyOf(stored ?? null)
  if (!place && !rules.trim()) return ''
  return [
    '## Notifying people',
    'When something needs a person and nobody is talking to you about it (a webhook call, a routine run), post it with the notify tool.',
    place ? `Your default place is ${place.chat_name || place.chat_id} on ${place.platform}.` : 'You have no default place, so pass place.',
    rules.trim() ? `Your owner's rules for where and when to notify:\n${rules.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export const notifyController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { params: IdParams } }, async (req) => {
    await agentService.requireVisible({ actor: await who(req), id: req.params.id })
    const row = await db.selectFrom('agent').select('notify').where('id', '=', req.params.id).executeTakeFirstOrThrow()
    return notifyOf(row.notify)
  })

  app.put('/', { schema: { params: IdParams, body: AgentNotify } }, async (req) => {
    const actor = await who(req)
    await agentService.requireOwner({ actor, id: req.params.id })
    const place = req.body.default
    if (place && !(await placeService.list({ agentId: req.params.id })).some((each) => each.platform === place.platform && each.chat_id === place.chat_id)) {
      throw new HttpError(400, 'Pick a place from the list. The agent has to be in that channel.', { param: 'default' })
    }
    const value: AgentNotify = { default: place, rules: req.body.rules.trim() }
    await db.updateTable('agent').set({ notify: JSON.stringify(value) }).where('id', '=', req.params.id).execute()
    await agentService.reapply({ id: req.params.id })
    emit({ name: 'agent.notify_updated', actor, target: { type: 'agent', id: req.params.id } })
    return value
  })
}

function notifyOf(stored: string | null): AgentNotify {
  if (!stored) return NONE
  const parsed = AgentNotify.safeParse(JSON.parse(stored))
  return parsed.success ? parsed.data : NONE
}
