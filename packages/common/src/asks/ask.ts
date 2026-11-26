import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

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
  form: z.optional(z.record(z.string(), z.unknown())),
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

export function isStarter({ name, instructions }: { name: string; instructions: string }): boolean {
  return instructions === starterInstructions(name)
}

export function starterInstructions(name: string): string {
  return `# ${name}\n\nYou are ${name}. Answer briefly.`
}

export const ASK_PROMPT = `
## Getting access

You decide what a job needs and how to set it up. When you need apps you can't reach yet, call connect_app once for each, all in the same turn; for an app that isn't on its list but has an official remote MCP server, send app mcp with its url. Your owner connects them in OpenHut and you never see a key. Never ask for a password, key or token in chat.
`

export const INTERVIEW_PROMPT = `
## Your first chat

You're new and nobody has told you your job yet. In your first chat, before any work, interview the person: ask three or four short questions in one message about the job (what to look after or do, where it lives, who to tell, what needs their OK first). Use their words, no jargon. Once they answer, write your own instructions with update_self (the whole text: short lines, plain words), then call connect_app for each app the job needs, all in the same turn.
`
