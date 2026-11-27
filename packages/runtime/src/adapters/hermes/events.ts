import * as z from 'zod'
import type { AgentEvents, Handler, Source } from '../../core/agent.ts'
import { plugins } from '../../core/plugins.ts'
import type { GatewayAgent } from '../../server/agents/agent-service.ts'
import { HttpError } from '../../server/platform/http-error.ts'

export const EVENTS = {
  pre_gateway_dispatch: 'message.arriving',
  transform_llm_output: 'reply.drafted',
  subagent_start: 'subagent.started',
  subagent_stop: 'subagent.stopped',
} as const satisfies Record<string, keyof AgentEvents>

type Hook = keyof typeof EVENTS
type Ins = { [H in Hook]: (args: Record<string, unknown>, origin: unknown) => AgentEvents[(typeof EVENTS)[H]]['in'] | undefined }
type Outs = { [H in Hook]: (out: AgentEvents[(typeof EVENTS)[H]]['out']) => unknown }

const Call = z.object({ args: z.record(z.string(), z.unknown()).default({}), origin: z.unknown() })
const Id = z.coerce.string().nullish().transform((value) => value ?? undefined)
const Dispatched = z.object({ event: z.object({ text: z.string(), source: z.object({ platform: z.string(), user_id: Id, user_name: Id, chat_id: Id }).nullish() }) })
const Reply = z.object({ response_text: z.string(), platform: z.string().nullish() })
const Chat = z.object({ chat_id: Id, thread_id: Id })
const Start = z.object({ child_session_id: z.string().min(1), child_goal: z.string().default('') })
const Stop = z.object({ child_session_id: z.string().min(1), child_status: z.string().nullish() })

const IN: Ins = {
  pre_gateway_dispatch: (args) => {
    const event = Dispatched.safeParse(args).data?.event
    if (!event) return undefined
    const source = event.source && { platform: event.source.platform, userId: event.source.user_id, userName: event.source.user_name, chatId: event.source.chat_id }
    return { text: event.text, ...source && { source } }
  },
  transform_llm_output: (args, origin) => {
    const { response_text: text, platform } = Reply.parse(args)
    const chat = Chat.safeParse(origin).data
    const source: Source | undefined = platform ? { platform, chatId: chat?.chat_id, threadId: chat?.thread_id } : undefined
    return { text, ...source && { source } }
  },
  subagent_start: (args) => {
    const found = Start.safeParse(args).data
    return found && { child: found.child_session_id, goal: found.child_goal }
  },
  subagent_stop: (args) => {
    const found = Stop.safeParse(args).data
    return found && { child: found.child_session_id, status: found.child_status ?? '' }
  },
}

const OUT: Outs = {
  pre_gateway_dispatch: (out) => out.allow !== undefined ? { action: 'allow', reason: out.allow } : { action: 'skip', reason: out.skip },
  transform_llm_output: (out) => out.text,
  subagent_start: () => null,
  subagent_stop: () => null,
}

export function handlers(): { [E in keyof AgentEvents]: Handler<E>[] } {
  const of = <E extends keyof AgentEvents>(event: E) => plugins().flatMap((plugin) => (plugin.on?.[event] as Handler<E> | undefined) ?? [])
  return { 'message.arriving': of('message.arriving'), 'reply.drafted': of('reply.drafted'), 'subagent.started': of('subagent.started'), 'subagent.stopped': of('subagent.stopped'), 'content.written': of('content.written') }
}

export async function emit<E extends keyof AgentEvents>({ agent, event, payload }: { agent: GatewayAgent; event: E; payload: AgentEvents[E]['in'] }): Promise<AgentEvents[E]['out'] | undefined> {
  let result: AgentEvents[E]['out'] | undefined
  for (const handler of handlers()[event] as Handler<E>[]) result ??= await handler({ agent, event: payload }) ?? undefined
  return result
}

export function hookNames(): Hook[] {
  const events = [...new Set(plugins().flatMap((plugin) => Object.keys(plugin.on ?? {})))]
  return events.flatMap((event) => (Object.keys(EVENTS) as Hook[]).filter((hook) => EVENTS[hook] === event))
}

export function manifest() {
  return {
    tools: plugins().flatMap((plugin) => Object.entries(plugin.tools ?? {}).filter(([, tool]) => tool.local).map(([name, tool]) => {
      const { $schema: _, ...parameters } = z.toJSONSchema(z.object(tool.input), { io: 'input' })
      return { name, description: tool.description, parameters }
    })),
    hooks: hookNames(),
    slack_actions: plugins().flatMap((plugin) => plugin.slackAction ? [plugin.slackAction.prefix] : []),
  }
}

export async function runHook({ agent, hook, body }: { agent: GatewayAgent; hook: string; body: unknown }): Promise<{ result: unknown }> {
  if (!Object.hasOwn(EVENTS, hook) || !hookNames().includes(hook as Hook)) throw new HttpError(404, `No plugin handles the Hermes hook ${hook}.`)
  const found = Call.safeParse(body)
  if (!found.success) throw new HttpError(400, `The hook's request doesn't fit: ${z.prettifyError(found.error)}.`)
  const name = hook as Hook
  const payload = IN[name](found.data.args, found.data.origin)
  if (!payload) return { result: null }
  const out = await emit({ agent, event: EVENTS[name], payload } as never) as never
  return { result: out === undefined ? null : OUT[name](out) ?? null }
}
