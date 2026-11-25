import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloud } from '../../../../src/server/platform/cloud.ts'
import { credits, MAX_CONTEXT, MAX_OUTPUT, openhut } from '../../../../src/server/models/providers/openhut.ts'

const KEY = 'sk-or-v1-from-the-cloud'
cloud.credits = async () => ({ object: 'credits', balance: 5_000_000, given: 5_000_000, ai: 0, computer: 0, models: [], cloudComputer: true, key: KEY })

test('openhut: output is capped at 8,192 tokens and context at 200k', () => {
  const cap = openhut.upstream.body!
  assert.equal(cap({ model: 'x', max_tokens: 100_000 }).max_tokens, MAX_OUTPUT)
  assert.equal(cap({ model: 'x' }).max_tokens, MAX_OUTPUT, 'a request that asks for no cap still gets one')
  assert.equal(cap({ model: 'x', max_tokens: 1_000 }).max_tokens, 1_000)
  assert.equal(JSON.stringify(cap({ model: 'x', max_completion_tokens: 50_000 })), JSON.stringify({ model: 'x', max_tokens: MAX_OUTPUT }), 'the other names for the cap are dropped')
  assert.equal(openhut.route({ gateway: 'http://gw', token: 't', model: 'x', contextLength: 1_048_576 }).contextLength, MAX_CONTEXT)
})

test('openhut: the key is not in the agent’s environment, only the gateway adds it', async () => {
  const route = openhut.route({ gateway: 'http://gw', token: 'agent-token', model: 'deepseek/deepseek-v4.1-flash', contextLength: null })
  const setup = openhut.setup({ gateway: 'http://gw', token: 'agent-token' })
  assert.equal(route.apiKey, 'agent-token')
  assert.equal(route.baseUrl, 'http://gw/u/openhut/v1')
  assert.ok(!JSON.stringify({ route, setup }).includes(KEY))
  const out = { path: '/v1/chat/completions', headers: new Headers() }
  openhut.upstream.apply({ out, secret: await openhut.upstream.credential({} as never, {}) })
  assert.equal(out.headers.get('authorization'), `Bearer ${KEY}`)
  assert.ok(!JSON.stringify(await credits()).includes(KEY), 'GET /api/credits never shows the key')
})
