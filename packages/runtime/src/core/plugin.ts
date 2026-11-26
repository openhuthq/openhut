import type * as z from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Kysely } from 'kysely'
import type { Database } from '../server/platform/db-schema.ts'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import type { Slots } from '../server/models/model-slots.ts'
import type { RenderedChannel } from '../plugins/channels/index.ts'
import type { Origin } from '../server/inbox/routines.ts'

export type HermesCtx = {
  agent: { id: string; name: string; instructions: string; slots: Slots; net: number; code_execution: boolean; web_browser: boolean }
  gateway: string
  token: string
  channelKey: string
  channels: RenderedChannel[]
  connections: { name: string; kind: string }[]
  secrets: { name: string; hosts: string[] }[]
}

export type HermesPart = {
  prompt?: string
  config?: Record<string, unknown>
  env?: Record<string, string>
  auth?: object
}

export type ToolResult = string | { text: string; isError: boolean } | { send: { target: string; message: string } }

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  description: string
  input: S
  local?: true
  run(input: z.infer<z.ZodObject<S>>, ctx: { agent: GatewayAgent; origin: unknown }): Promise<ToolResult>
}

export type Wake = { id: string; text: string; origin: Origin }

export type Plugin = {
  name: string
  hermes?: (ctx: HermesCtx) => HermesPart
  tools?: Record<string, Tool>
  hooks?: Record<string, (x: { agent: GatewayAgent; args: Record<string, unknown>; origin: unknown }) => Promise<unknown>>
  wakes?: {
    due: (x: { agentId: string }) => Promise<Wake[]>
    picked: (x: { agentId: string; id: string }) => Promise<void>
    said?: (x: { agentId: string; id: string; reply: string }) => Promise<void>
  }
  start?: () => void
  migrate?: (db: Kysely<Database>) => Promise<void>
  routes?: () => Record<string, FastifyPluginAsyncZod>
  afterTurn?: (x: { agentId: string; since: Date }) => Promise<{ type: `data-${string}`; data: unknown } | undefined>
  slackAction?: { prefix: string; run: (x: { agent: GatewayAgent; body: unknown; action: { action_id: string; value?: string } }) => Promise<{ text: string; origin: Origin } | undefined> }
}

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin

export const defineTool = <S extends z.ZodRawShape>(tool: Tool<S>): Tool<S> => tool

export const APP_PLATFORM = 'api_server'
