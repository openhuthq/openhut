import type { ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import { log } from '../platform/events.ts'

const ChatRequest = z.object({
  model: z.optional(z.string()),
  stream: z.optional(z.boolean()),
  messages: z.optional(z.array(z.object({ role: z.optional(z.string()), content: z.optional(z.unknown()) }))),
  tools: z.optional(z.array(z.object({ name: z.optional(z.string()), function: z.optional(z.object({ name: z.optional(z.string()) })) }))),
})
const USAGE = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }

export function testModel({ path, body, res }: { path: string; body: unknown; res: ServerResponse }): void {
  if (path.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'jakebox-test', object: 'model', context_length: 200000 }] }))
    return
  }
  const request = z.safeParse(ChatRequest, body).data ?? {}
  const messages = request.messages ?? []
  const last = messages.at(-1) ?? {}
  const toolNames = (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter((name) => name !== undefined)
  const callTool = toolNames.find((name) => name.endsWith('call_tool'))
  log.info({ event: 'test_llm.request', message: `test-llm: ${messages.length} msgs, last=${last.role}, ${toolNames.length} tools${callTool ? ` incl ${callTool}` : ''}` })
  const reply = replyTo({ last, callTool })
  const base = { id: `cmpl-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: request.model ?? 'jakebox-test' }
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

function replyTo({ last, callTool }: { last: { role?: string; content?: unknown }; callTool: string | undefined }): { content?: string; tool?: { name: string; args: string } } {
  if (last.role === 'tool') return { content: `TOOL RESULT: ${asText(last.content).slice(0, 20_000)}` }
  const sql = /sql:\s*([\s\S]+?)\s*$/i.exec(asText(last.content))?.[1]
  if (sql && callTool) return { tool: { name: callTool, args: JSON.stringify({ reason: 'The user asked for data', name: 'postgres_query', arguments: { sql } }) } }
  return { content: `ECHO: ${asText(last.content).slice(-200)}` }
}

function asText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part: unknown) => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '').join(' ')
}
