import * as z from 'zod'
import type { GatewayAgent } from '../server/agents/agent-service.ts'
import { HttpError } from '../server/platform/http-error.ts'
import { plugins } from './plugins.ts'

const Call = z.object({ args: z.record(z.string(), z.unknown()).default({}), origin: z.unknown() })
const SlackAction = z.object({ body: z.record(z.string(), z.unknown()), action: z.looseObject({ action_id: z.string().max(255), value: z.string().max(2000).optional() }) })

export function manifest() {
  return {
    tools: plugins().flatMap((plugin) => Object.entries(plugin.tools ?? {}).filter(([, tool]) => tool.local).map(([name, tool]) => {
      const { $schema: _, ...parameters } = z.toJSONSchema(z.object(tool.input), { io: 'input' })
      return { name, description: tool.description, parameters }
    })),
    hooks: [...new Set(plugins().flatMap((plugin) => Object.keys(plugin.hooks ?? {})))],
    slack_actions: plugins().flatMap((plugin) => plugin.slackAction ? [plugin.slackAction.prefix] : []),
  }
}

export async function runLocal({ agent, name, body }: { agent: GatewayAgent; name: string; body: unknown }): Promise<{ text: string } | { send: { target: string; message: string } }> {
  const tool = plugins().flatMap((plugin) => Object.entries(plugin.tools ?? {})).find(([each, found]) => each === name && found.local)?.[1]
  if (!tool) throw new HttpError(404, `There is no local tool ${name}.`)
  const call = Call.safeParse(body)
  const input = call.success ? z.object(tool.input).safeParse(call.data.args) : undefined
  if (!call.success || !input?.success) throw new HttpError(400, `${name} can't use those arguments: ${input?.error ? z.prettifyError(input.error) : 'send args as an object'}.`)
  const result = await tool.run(input.data, { agent, origin: call.data.origin })
  if (typeof result === 'string') return { text: result }
  if ('send' in result) return { send: result.send }
  if (result.isError) throw new HttpError(400, result.text)
  return { text: result.text }
}

export async function runHook({ agent, hook, body }: { agent: GatewayAgent; hook: string; body: unknown }): Promise<{ result: unknown }> {
  const handlers = plugins().flatMap((plugin) => plugin.hooks?.[hook] ?? [])
  if (!handlers.length) throw new HttpError(404, `No plugin handles the Hermes hook ${hook}.`)
  const { args, origin } = parsed(Call, body)
  let result: unknown
  for (const handler of handlers) {
    const value = await handler({ agent, args, origin })
    result ??= value
  }
  return { result: result ?? null }
}

export async function runSlackAction({ agent, body }: { agent: GatewayAgent; body: unknown }): Promise<{ inject?: { text: string; origin: object } }> {
  const { body: payload, action } = parsed(SlackAction, body)
  const found = plugins().find((plugin) => plugin.slackAction && action.action_id.startsWith(plugin.slackAction.prefix))?.slackAction
  const inject = await found?.run({ agent, body: payload, action })
  return inject ? { inject } : {}
}

function parsed<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const found = schema.safeParse(body)
  if (!found.success) throw new HttpError(400, `The hook's request doesn't fit: ${z.prettifyError(found.error)}.`)
  return found.data
}
