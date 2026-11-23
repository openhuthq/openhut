import * as z from 'zod/mini'
import { describeIssues } from '../platform/validation.ts'

export function nativeConnector<C>({ config, tools }: { config: z.ZodMiniType<C>; tools: Record<string, NativeTool<C>> }): Connector {
  return {
    tools: async () => Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, schema: z.toJSONSchema(tool.input) })),
    call: async ({ config: stored, tool, args }) => {
      const spec = Object.hasOwn(tools, tool) ? tools[tool] : undefined
      if (!spec) return { text: `No tool named ${tool}. Use ${Object.keys(tools).join(', ')}.`, isError: true }
      const parsed = z.safeParse(spec.input, args)
      if (!parsed.success) return { text: `${argumentProblem(parsed.error.issues)}. Call describe_tool to see what it takes.`, isError: true }
      return { text: JSON.stringify(await spec.run({ config: z.parse(config, stored), args: parsed.data })), isError: false }
    },
  }
}

export function nativeTool<C, S extends z.ZodMiniObject>(tool: { description: string; input: S; run: (call: { config: C; args: z.infer<S> }) => Promise<unknown> }): NativeTool<C> {
  return { description: tool.description, input: tool.input, run: ({ config, args }) => tool.run({ config, args: z.parse(tool.input, args) }) }
}

function argumentProblem(issues: z.core.$ZodIssue[]): string {
  const unknown = issues.flatMap((issue) => issue.code === 'unrecognized_keys' ? issue.keys : [])
  return unknown.length ? `Unknown arguments: ${unknown.join(', ')}` : `Invalid arguments: ${describeIssues(issues)}`
}

export type Connector = {
  tools: (ctx: ConnectorContext) => Promise<ToolSpec[]>
  call: (ctx: ConnectorContext & { tool: string; args: Record<string, unknown> }) => Promise<ToolResult>
}
export type ConnectorContext = { config: unknown; refresh: (renew: (latest: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>> }
export type ToolSpec = { name: string; description: string; schema: Record<string, unknown> }
export type ToolResult = { text: string; isError: boolean }
type NativeTool<C> = { description: string; input: z.ZodMiniObject; run: (call: { config: C; args: unknown }) => Promise<unknown> }
