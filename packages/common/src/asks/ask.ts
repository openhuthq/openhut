import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { CONNECTION_TITLES, ConnectionKind } from '../connections/connection.ts'

export const AskStatus = z.enum(['open', 'done', 'declined', 'expired'])
export type AskStatus = z.infer<typeof AskStatus>

export const Ask = z.object({
  id: z.string(),
  object: z.literal('ask'),
  kind: z.string(),
  agentId: z.string(),
  title: z.string(),
  why: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: AskStatus,
  note: z.nullable(z.string()),
  createdAt: Timestamp,
  answeredAt: z.nullable(Timestamp),
})
export type Ask = z.infer<typeof Ask>

export const ListAsks = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListAsks = z.infer<typeof ListAsks>

export const ApproveAsk = z.object({ answer: z.optional(z.record(z.string(), z.unknown())) })
export type ApproveAsk = z.infer<typeof ApproveAsk>

export const DeclineAsk = z.object({ note: z.optional(z.string().check(z.maxLength(500))) })
export type DeclineAsk = z.infer<typeof DeclineAsk>

export const OPEN_PAGE = 'https://openhut.dev/open'
export const MCP_AUTH = ['header', 'sign_in', 'public'] as const
export type McpAuth = typeof MCP_AUTH[number]
const BRANDED_HOSTS = ['cloudflare', 'digitalocean']
const ASKED = /^\/connections\/new\/([a-z_]+)\?([^#]*)$/

export type AppAsk = { agentId: string; app: ConnectionKind; url?: string; name?: string; auth?: McpAuth }

export function askPath({ agentId, app, url, name, auth }: AppAsk): string {
  return `/connections/new/${app}?${new URLSearchParams({ for: agentId, ...(url && { url }), ...(name && { name }), ...(auth && { auth }) })}`
}

export function askedPath(link: string): string | undefined {
  const hash = link.startsWith(`${OPEN_PAGE}#`) ? link.slice(OPEN_PAGE.length + 1) : undefined
  const [, kind, query] = (hash && ASKED.exec(hash)) || []
  return hash && ConnectionKind.safeParse(kind).success && !new URLSearchParams(query).has('error') ? hash : undefined
}

export function brandOf({ app, url }: Pick<AppAsk, 'app' | 'url'>): string {
  const host = url ? new URL(url).hostname : undefined
  return app === 'mcp' ? BRANDED_HOSTS.find((each) => host === `${each}.com` || host?.endsWith(`.${each}.com`)) ?? 'mcp' : app
}

export function askCard({ asks, why }: { asks: (AppAsk & { line?: string })[]; why: string }): string {
  const titleOf = (ask: AppAsk) => ask.name ?? CONNECTION_TITLES[ask.app]
  const ids = asks.map((_, index) => `app${index}`)
  const patch = [
    { op: 'add', path: '/root', value: 'ask' },
    { op: 'add', path: '/elements/ask', value: { type: 'Card', props: { title: asks.length === 1 ? `Connect ${titleOf(asks[0])}` : 'Connect apps' }, children: ['why', ...ids] } },
    { op: 'add', path: '/elements/why', value: { type: 'Text', props: { content: why } } },
    ...asks.map((ask, index) => {
      const subtitle = ask.line ?? (ask.url && new URL(ask.url).hostname)
      return { op: 'add', path: `/elements/${ids[index]}`, value: { type: 'Connect', props: { title: titleOf(ask), brand: brandOf(ask), ...(subtitle && { subtitle }), url: `${OPEN_PAGE}#${askPath(ask)}` } } }
    }),
  ]
  return `\`\`\`spec\n${patch.map((line) => JSON.stringify(line)).join('\n')}\n\`\`\``
}

export function isStarter({ name, instructions }: { name: string; instructions: string }): boolean {
  return instructions === starterInstructions(name)
}

export function starterInstructions(name: string): string {
  return `# ${name}\n\nYou are ${name}. Answer briefly.`
}

export const ASK_PROMPT = `
## Getting access

You decide what a job needs and how to set it up. When you need apps you can't reach yet, ask for all of them in one ask_to_connect call. For an app that isn't on ask_to_connect's list but has an official remote MCP server, use propose_connection: your owner pastes the token in OpenHut and you never see it. Never ask for a password, key or token in chat.
`

export const INTERVIEW_PROMPT = `
## Your first chat

You're new and nobody has told you your job yet. In your first chat, before any work, interview the person: ask three or four short questions in one message about the job (what to look after or do, where it lives, who to tell, what needs their OK first). Use their words, no jargon. Once they answer, write your own instructions with update_self (the whole text: short lines, plain words), then ask for the apps the job needs in one ask_to_connect call, and propose_connection for any app that isn't on its list.
`
