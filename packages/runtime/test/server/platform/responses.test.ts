import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyRequest } from 'fastify'
import { forOlderApps } from '../../../src/server/platform/responses.ts'

const from = (version?: string) => ({ headers: version ? { 'openhut-app-version': version } : {} }) as unknown as FastifyRequest
const agent = (model: string) => ({ id: 'ag_1', object: 'agent', model, name: 'Dev' })
const list = { object: 'list', url: '/api/agents', hasMore: false, data: [agent('claude:opus'), agent('codex:gpt-5.5'), agent('openrouter:x/y')] }

test('an app from before model keys gets the model ids it knows', () => {
  for (const version of ['0.1.0', '0.1.1']) {
    assert.deepEqual((forOlderApps({ req: from(version), payload: list }) as typeof list).data.map((each) => each.model), ['opus', 'codex', 'sonnet'])
    assert.equal((forOlderApps({ req: from(version), payload: agent('claude:haiku') }) as { model: string }).model, 'haiku')
  }
})

test('newer apps, the local app and anything that is not an agent are left alone', () => {
  for (const version of ['0.1.2', '0.2.0', '1.0.0', undefined, 'dev']) assert.equal(forOlderApps({ req: from(version), payload: list }), list)
  const other = { object: 'connection', model: 'claude:opus' }
  assert.equal(forOlderApps({ req: from('0.1.1'), payload: other }), other)
})
