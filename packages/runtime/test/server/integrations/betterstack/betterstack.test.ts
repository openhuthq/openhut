import { test } from 'node:test'
import assert from 'node:assert/strict'
import { betterstack } from '../../../../src/server/integrations/betterstack/betterstack.ts'

const call = (tool: string, args: Record<string, unknown> = {}) => betterstack.connector.call({ config: { token: 'tok123' }, refresh: async () => ({}), tool, args })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

test('search matches text in any case, with quotes and backslashes escaped', () => {
  assert.equal(betterstack.searchSql(undefined), 'SELECT dt, raw FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} ORDER BY dt DESC')
  assert.equal(betterstack.searchSql('it\'s C:\\tmp'), 'SELECT dt, raw FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} AND positionCaseInsensitive(raw, \'it\\\'s C:\\\\tmp\') > 0 ORDER BY dt DESC')
})

test('a query that writes is refused, a read becomes the documented body', () => {
  assert.throws(() => betterstack.queryBody({ sourceId: 1, sql: 'insert into {{source}} values (1)' }), /^Error: Refused/)
  assert.deepEqual(betterstack.queryBody({ sourceId: 7, sql: 'select count() from {{source}}', from: 'now-3h', to: 'now', limit: 10, sourceType: 'logs' }), { source_id: 7, query: 'select count() from {{source}}', start_time: 'now-3h', end_time: 'now', limit: 10, source_type: 'logs' })
})

test('search posts to the query API with the token, the range and the limit', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ data: { type: 'query_result', attributes: { rows: [{ dt: '2026-11-27 10:00:00', raw: '{"msg":"payment failed"}' }] } } }))
  const result = await call('search', { sourceId: 42, text: 'payment', from: 'now-3h' })
  assert.deepEqual(JSON.parse(result.text), { rows: [{ dt: '2026-11-27 10:00:00', raw: '{"msg":"payment failed"}' }] })
  const [url, init] = fetch.mock.calls[0].arguments as [string, RequestInit & { headers: Record<string, string> }]
  assert.equal(url, 'https://telemetry.betterstack.com/api/v2/query')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer tok123')
  const body = JSON.parse(String(init.body)) as Record<string, unknown>
  assert.equal(body.source_id, 42)
  assert.equal(body.start_time, 'now-3h')
  assert.equal(body.limit, 100)
  assert.equal(body.source_type, 'logs')
  assert.match(String(body.query), /positionCaseInsensitive\(raw, 'payment'\)/)
})

test('limits outside 1 to 1000 are turned down before a call', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}))
  assert.equal((await call('query', { sourceId: 1, sql: 'select 1', limit: 5000 })).isError, true)
  assert.equal(fetch.mock.callCount(), 0)
})

test('sources follow pages on Better Stack only and never hand out the ingest token', async (t) => {
  const urls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url)
    if (urls.length === 1) return json({ data: [{ id: '1', type: 'source', attributes: { name: 'api', platform: 'docker', team_name: 'Acme', token: 'ingest-secret', logs_retention: 30 } }], pagination: { next: 'https://telemetry.betterstack.com/api/v3/sources?page=2&per_page=250' } })
    return json({ data: [{ id: '2', type: 'source', attributes: { name: 'web', platform: 'vercel', token: 'ingest-secret-2' } }], pagination: { next: 'https://evil.example.com/steal' } })
  })
  const result = await call('sources')
  assert.ok(!result.text.includes('ingest-secret'))
  assert.deepEqual(JSON.parse(result.text), { sources: [{ id: 1, name: 'api', platform: 'docker', team: 'Acme', retentionDays: 30 }, { id: 2, name: 'web', platform: 'vercel' }], truncated: true })
  assert.deepEqual(urls, ['https://telemetry.betterstack.com/api/v3/sources?per_page=250', 'https://telemetry.betterstack.com/api/v3/sources?page=2&per_page=250'])
})

test('errors say what went wrong in plain words', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ errors: 'Source not found' }, 404))
  await assert.rejects(call('query', { sourceId: 9, sql: 'select 1' }), /No source with that id/)
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => json({ errors: 'Unknown identifier: nope' }, 422))
  await assert.rejects(call('query', { sourceId: 9, sql: 'select nope from {{source}}' }), { message: 'Better Stack answered 422: Unknown identifier: nope' })
})

test('the token is checked on save', async (t) => {
  await assert.rejects(betterstack.probe('has space'), { param: 'token' })
  t.mock.method(globalThis, 'fetch', async () => json({ errors: 'Invalid Team API token' }, 401))
  await assert.rejects(betterstack.probe('bad'), { param: 'token', message: 'Better Stack turned down that token. Copy a Telemetry API token again and paste it.' })
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => json({ data: [{ id: '1', attributes: { team_name: 'Acme' } }] }))
  assert.equal(await betterstack.probe('good'), 'Acme')
})
