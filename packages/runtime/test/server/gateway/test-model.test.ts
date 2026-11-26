import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerResponse } from 'node:http'
import { testModel } from '../../../src/server/gateway/test-model.ts'

function reply(text: string) {
  let body = ''
  const res = { writeHead: () => res, end: (chunk: string) => { body = chunk } } as unknown as ServerResponse
  testModel({ path: '/test-llm/v1/chat/completions', body: { messages: [{ role: 'user', content: text }], tools: [{ function: { name: 'mcp_openhut_add_webhook' } }, { function: { name: 'mcp_openhut_update_self' } }] }, res })
  return JSON.parse(body).choices[0].message
}

test('the test model makes every call a calls: list names in one turn, and one call with call:', () => {
  const many = reply('calls: [{"tool":"add_webhook","args":{"name":"A"}},{"tool":"update_self","args":{"name":"B"}}]')
  assert.deepEqual(many.tool_calls.map((call: { function: { name: string; arguments: string } }) => [call.function.name, JSON.parse(call.function.arguments)]), [['mcp_openhut_add_webhook', { name: 'A' }], ['mcp_openhut_update_self', { name: 'B' }]])
  assert.equal(reply('call: {"tool":"update_self","args":{"name":"C"}}').tool_calls.length, 1)
})
