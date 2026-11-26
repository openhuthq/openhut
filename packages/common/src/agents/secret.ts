import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const SECRET_HEADER = 'Authorization: Bearer {value}'
export const secretPlaceholder = (name: string): string => `openhut-secret-${name}`
const UNSETTABLE = /^(host|content-length|transfer-encoding|connection|te|upgrade|trailer|keep-alive|proxy-.*)$/i

export const SecretName = z.string().check(z.regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use capitals, digits and _, like STRIPE_KEY.'))
export const SecretHost = z.string().check(z.maxLength(253), z.regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Use a host name like api.stripe.com, without https:// or a path.'))
export const SecretHeader = z.string().check(
  z.maxLength(200),
  z.regex(/^[A-Za-z0-9-]+: [^\r\n]*\{value\}[^\r\n]*$/, 'Write the header like Authorization: Bearer {value}.'),
  z.refine((header) => !UNSETTABLE.test(header.split(':')[0]), 'That header can\'t carry a key.'),
)
export const SecretValue = z.string().check(z.minLength(1), z.maxLength(4000), z.regex(/^[^\r\n]*$/, 'Paste the key on one line.'))

export const AddSecret = z.object({
  name: SecretName,
  hosts: z.array(SecretHost).check(z.minLength(1), z.maxLength(10)),
  header: z._default(SecretHeader, SECRET_HEADER),
})
export type AddSecret = z.infer<typeof AddSecret>

export const AgentSecret = z.object({
  id: z.string(),
  object: z.literal('agent_secret'),
  agentId: z.string(),
  name: z.string(),
  hosts: z.array(z.string()),
  header: z.string(),
  createdAt: Timestamp,
  usedAt: z.nullable(Timestamp),
})
export type AgentSecret = z.infer<typeof AgentSecret>

export const ListAgentSecrets = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListAgentSecrets = z.infer<typeof ListAgentSecrets>

export const ReplaceSecretValue = z.object({ value: SecretValue })
export type ReplaceSecretValue = z.infer<typeof ReplaceSecretValue>
