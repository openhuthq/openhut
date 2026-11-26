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

test('the test model echoes an asks wake in full, so the e2e can read every answer in it', () => {
  const wake = `[OpenHut asks:wk_abcdefgh] Your owner answered 2 of your asks:\n- ${'x'.repeat(300)}\n- Last.`
  assert.equal(reply(`Note: ${wake}`).content, `ECHO: ${wake}`)
})

test('the test model answers card: with a reply that holds a card, in a chat or in an answered ask', () => {
  for (const said of ['card: Droplet', '[OpenHut asks:wk_abcdefgh] Your owner answered your ask:\n- You can use card: Droplet now (cn_x).']) {
    const content: string = reply(said).content
    assert.match(content, /^Here it is\.\n\n```spec\n/)
    assert.match(content, /"title":"Droplet"/)
  }
})
