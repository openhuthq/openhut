import * as z from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Kysely } from 'kysely'
import type { Database } from '../server/platform/db-schema.ts'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import type { AgentCtx, AgentEvents, AgentPart, Handler } from './agent.ts'
import type { Origin } from '../server/inbox/routines.ts'
import type { Caller } from '../server/team/identity.ts'

export type ToolResult = string | { text: string; isError: boolean } | { send: { target: string; message: string } }

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  description: string
  input: S
  local?: true
  run(input: z.infer<z.ZodObject<S>>, ctx: { agent: GatewayAgent; origin: unknown }): Promise<ToolResult>
}

export type Wake = { id: string; text: string; origin: Origin }

export const AskDescription = z.string()
  .min(3, 'Add a description: one short sentence for your owner about what this is for, like "Push the changelog fix to openhuthq/openhut".')
  .max(120, 'Keep the description to one short sentence under 120 characters, like "Push the changelog fix to openhuthq/openhut".')
  .describe('One short sentence for your owner, in plain words, about what this is for: no tool names, no jargon. Like "Push the changelog fix to openhuthq/openhut".')

export type AskOf<I> = { id: string; agentId: string; input: I; description: string; origin: Origin }

export type AskKind<I extends z.ZodObject = z.ZodObject, A extends z.ZodObject | undefined = undefined> = {
  input: I
  tool?: string
  answer?: A
  title(x: { agentId: string; input: z.infer<I> }): string | Promise<string>
  run(x: { actor: Caller; ask: AskOf<z.infer<I>>; answer: A extends z.ZodObject ? z.infer<A> : undefined }): Promise<string | void>
  declined?(x: { actor: Caller; ask: AskOf<z.infer<I>> }): Promise<void>
}

export type Plugin = {
  name: string
  asks?: Record<string, AskKind<z.ZodObject, z.ZodObject | undefined>>
  agent?: (ctx: AgentCtx) => AgentPart
  tools?: Record<string, Tool>
  on?: { [E in keyof AgentEvents]?: Handler<E> }
  wakes?: {
    due: (x: { agentId: string }) => Promise<Wake[]>
    picked: (x: { agentId: string; id: string }) => Promise<void>
    said?: (x: { agentId: string; id: string; reply: string }) => Promise<void>
  }
  start?: () => void
  migrate?: (db: Kysely<Database>) => Promise<void>
  routes?: () => Record<string, FastifyPluginAsyncZod>
  connectorCall?: (x: { agentId: string; kind: string; tool: string; args: Record<string, unknown> }) => Promise<Record<string, unknown>>
  afterTurn?: (x: { agentId: string; since: Date }) => Promise<{ type: `data-${string}`; data: unknown } | undefined>
  slackAction?: { prefix: string; run: (x: { agent: GatewayAgent; body: unknown; action: { action_id: string; value?: string } }) => Promise<{ text: string; origin: Origin } | undefined> }
}

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin

export const defineAsk = <I extends z.ZodObject, A extends z.ZodObject | undefined = undefined>(kind: AskKind<I, A>): AskKind<I, A> => kind

export const defineTool = <S extends z.ZodRawShape>(tool: Tool<S>): Tool<S> => tool

export const APP_PLATFORM = 'api_server'
