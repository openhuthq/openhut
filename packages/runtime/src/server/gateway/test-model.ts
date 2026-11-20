import type { IncomingMessage, ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import { log } from '../platform/events.ts'
import { settings } from '../platform/settings.ts'

const ChatRequest = z.object({
  model: z.optional(z.string()),
  stream: z.optional(z.boolean()),
  messages: z.optional(z.array(z.object({ role: z.optional(z.string()), content: z.optional(z.unknown()) }))),
  tools: z.optional(z.array(z.object({ name: z.optional(z.string()), function: z.optional(z.object({ name: z.optional(z.string()) })) }))),
})
const USAGE = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }

export function testModel({ path, body, res }: { path: string; body: unknown; res: ServerResponse }): void {
  if (path.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'openhut-test', object: 'model', context_length: 200000 }] }))
    return
  }
  const request = z.safeParse(ChatRequest, body).data ?? {}
  const messages = request.messages ?? []
  const last = messages.at(-1) ?? {}
  const toolNames = (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter((name) => name !== undefined)
  const callTool = toolNames.find((name) => name.endsWith('call_tool'))
  log.info({ event: 'test_llm.request', messages: messages.length, lastRole: last.role, tools: toolNames.length, callTool })
  const reply = replyTo({ last, callTool, shell: toolNames.find((name) => name === 'terminal' || name === 'Bash'), schedule: toolNames.find((name) => name.endsWith('schedule_routine')) })
  const base = { id: `cmpl-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: request.model ?? 'openhut-test' }
  const toolCalls = reply.tool ? [{ id: `call_${Date.now()}`, type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] : undefined
  const finish = reply.tool ? 'tool_calls' : 'stop'
  if (request.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const delta = { role: 'assistant', ...(reply.content && { content: reply.content }), ...(toolCalls && { tool_calls: toolCalls.map((call, index) => ({ index, ...call })) }) }
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: USAGE })}\n\n`)
    res.end('data: [DONE]\n\n')
    return
  }
  const message = { role: 'assistant', content: reply.content ?? null, ...(toolCalls && { tool_calls: toolCalls }) }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage: USAGE }))
}

export function testAnthropic({ req, body, res }: { req: IncomingMessage; body: unknown; res: ServerResponse }): void {
  const seat = settings.seatToken()
  if (!seat || req.headers.authorization !== `Bearer ${seat}`) {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Invalid bearer token' } }))
    return
  }
  const request = z.safeParse(ChatRequest, body).data ?? {}
  const text = `ECHO: ${asText(request.messages?.at(-1)?.content).slice(-200)}`
  const reset = Math.floor(Date.now() / 1000) + 3600
  res.writeHead(200, { 'content-type': 'application/json', 'anthropic-ratelimit-unified-5h-utilization': '0.12', 'anthropic-ratelimit-unified-5h-reset': String(reset), 'anthropic-ratelimit-unified-7d-utilization': '0.34', 'anthropic-ratelimit-unified-7d-reset': String(reset) })
    .end(JSON.stringify({ id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: request.model ?? 'openhut-test', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }))
}

function replyTo({ last, callTool, shell, schedule }: { last: { role?: string; content?: unknown }; callTool: string | undefined; shell: string | undefined; schedule: string | undefined }): { content?: string; tool?: { name: string; args: string } } {
  if (last.role === 'tool') return { content: `TOOL RESULT: ${asText(last.content).slice(0, 20_000)}` }
  const routine = /\[Routine rt_\w+ · run ru_\w+\] Time for "([^"]+)"/.exec(asText(last.content))?.[1]
  if (routine) return { content: `ROUTINE RAN: ${routine}` }
  const wanted = /routine:\s*(\{[\s\S]+\})\s*$/i.exec(lastText(last.content))?.[1]
  if (wanted && schedule) return { tool: { name: schedule, args: wanted } }
  const sql = /sql:\s*([\s\S]+?)\s*$/i.exec(asText(last.content))?.[1]
  if (sql && callTool) return { tool: { name: callTool, args: JSON.stringify({ reason: 'The user asked for data', name: 'postgres_query', arguments: { sql } }) } }
  const command = /browser:\s*([a-z][a-z -]*(?:\s+[^\s'"`$;&|<>\\]+)*)\s*"?\s*$/i.exec(lastText(last.content))?.[1]
  if (command && shell) return { tool: { name: shell, args: JSON.stringify({ command: `agent-browser ${command}`, description: 'Use the browser' }) } }
  return { content: `ECHO: ${asText(last.content).slice(-200)}` }
}

function lastText(content: unknown): string {
  return Array.isArray(content) ? asText(content.filter((part: unknown) => typeof part === 'object' && part !== null && 'text' in part).slice(-1)) : asText(content)
}

function asText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part: unknown) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '').join(' ')
}
