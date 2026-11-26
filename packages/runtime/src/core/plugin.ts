import type * as z from 'zod'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import type { Slots } from '../server/models/model-slots.ts'
import type { RenderedChannel } from '../plugins/channels/index.ts'

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

export type ToolResult = string | { text: string; isError: boolean }

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  description: string
  input: S
  run(input: z.infer<z.ZodObject<S>>, ctx: { agent: GatewayAgent; origin: unknown }): Promise<ToolResult>
}

export type Plugin = {
  name: string
  hermes?: (ctx: HermesCtx) => HermesPart
  tools?: Record<string, Tool>
}

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin

export const defineTool = <S extends z.ZodRawShape>(tool: Tool<S>): Tool<S> => tool
