import * as z from 'zod'
import * as mini from 'zod/mini'
import { AddSecret, SECRET_HEADER, secretPlaceholder } from '@openhut/common/agents/secret.ts'
import { defineAsk, definePlugin } from '../../core/plugin.ts'
import { secretService } from '../../server/agents/secret-service.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { describeIssues, HttpError } from '../../server/platform/http-error.ts'
import { secretController } from '../../server/agents/secret-controller.ts'
import { createTables } from './tables.ts'

const KEY_LINE = 'Paste the key, on one line, to save it.'

export const keys = definePlugin({
  name: 'keys',
  migrate: createTables,
  routes: () => ({ '/api/agent-secrets': secretController }),
  hermes: ({ secrets }) => ({
    prompt: keysNote(secrets),
    env: Object.fromEntries(secrets.map(({ name }) => [`OPENHUT_SECRET_${name}`, secretPlaceholder(name)])),
  }),
  asks: {
    add_secret: defineAsk({
      input: z.object({
        name: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).describe('Capitals, digits and _, like STRIPE_KEY. Your terminal gets $OPENHUT_SECRET_<name>, a stand-in, never the key.'),
        hosts: z.array(z.string().max(253)).min(1).max(10).describe('The API hosts the key may go to, like api.stripe.com. No https://, no path.'),
        header: z.string().max(200).default(SECRET_HEADER).describe('How the service wants it, with {value} for the key. Default: Authorization: Bearer {value}. Stripe: Authorization: Bearer {value}; others: X-Api-Key: {value}.'),
      }),
      answer: z.object({ value: z.string({ error: KEY_LINE }).min(1, KEY_LINE).max(4000, KEY_LINE).regex(/^[^\r\n]*$/, KEY_LINE).meta({ secret: true }) }),
      tool: 'Ask your owner for an API key or token you need, like a Stripe key. They paste it in OpenHut; you never see it. Once saved, call the service through $OPENHUT_GATEWAY/x/<host>/<path> and OpenHut adds the key, only for the hosts you list. Never ask anyone to paste a key into a chat.',
      title: ({ input }) => {
        const { name, hosts } = secretOf(input)
        return `Save a key, ${name}, sent only to ${hosts.join(', ')}`
      },
      run: async ({ ask: { agentId, input }, answer }) => {
        const secret = secretOf(input)
        await agentService.quietly({ id: agentId, change: () => secretService.save({ agentId, input: secret, value: answer.value }) })
        return `You have already restarted with it. You never see the key: call https://${secret.hosts[0]}/… as $OPENHUT_GATEWAY/x/${secret.hosts[0]}/… with the header "Authorization: Agent $OPENHUT_AGENT_TOKEN", and OpenHut adds it.`
      },
    }),
  },
})

function secretOf(input: object): AddSecret {
  const parsed = mini.safeParse(AddSecret, input)
  if (!parsed.success) throw new HttpError(400, `That key isn't valid. ${describeIssues(parsed.error.issues)}`)
  return parsed.data
}

function keysNote(secrets: { name: string; hosts: string[] }[]): string {
  if (!secrets.length) return ''
  const [first] = secrets
  return `## Keys

Your owner saved these keys for you: ${secrets.map(({ name, hosts }) => `${name} (only sent to ${hosts.join(', ')})`).join('; ')}. You never see them.
To call https://${first.hosts[0]}/some/path, call $OPENHUT_GATEWAY/x/${first.hosts[0]}/some/path with the header "Authorization: Agent $OPENHUT_AGENT_TOKEN": OpenHut adds the key on its way out, in the header your owner set for it. Never put $OPENHUT_SECRET_<NAME> (a stand-in) in the URL or another header: the gateway refuses it. Need another key? Ask with add_secret.`
}
