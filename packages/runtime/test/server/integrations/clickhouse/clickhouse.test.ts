import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clickhouse } from '../../../../src/server/integrations/clickhouse/clickhouse.ts'

const DSN = 'https://reader:p%40ss@203.0.113.7:8443/logs'
const call = (tool: string, args: Record<string, unknown> = {}) => clickhouse.connector.call({ config: { dsn: DSN }, refresh: async () => ({}), tool, args })

function answer(body: string, status = 200): Response {
  return new Response(body, { status })
}

test('only reads get through the guard, comments and brackets first included', () => {
  for (const sql of ['select 1', ' SELECT 1', 'with a as (select 1) select * from a', 'show tables', 'describe logs', 'desc logs', 'explain select 1', 'exists table logs', '-- why\nselect 1', '/* why */ (select 1)']) assert.ok(clickhouse.readOnlySql(sql), sql)
  for (const sql of ['insert into logs values (1)', 'alter table logs delete where 1', 'drop table logs', 'create table x (a Int8) engine = Memory', 'truncate logs', 'system flush logs', 'optimize table logs', 'set readonly = 0', 'kill query where 1', 'grant select on *.* to x', '/* select */ drop table logs']) assert.ok(!clickhouse.readOnlySql(sql), sql)
})

test('a write is refused before anything is sent', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => answer(''))
  const result = await clickhouse.query({ dsn: DSN, sql: 'insert into logs values (1)' }).catch((err: Error) => err.message)
  assert.match(String(result), /^Refused: only SELECT/)
  assert.equal(fetch.mock.callCount(), 0)
})

test('the address takes https or http, no settings, and the usual ports', () => {
  assert.deepEqual(clickhouse.parseDsn(DSN), { origin: 'https://203.0.113.7:8443', host: '203.0.113.7', port: 8443, user: 'reader', password: 'p@ss', database: 'logs' })
  assert.equal(clickhouse.parseDsn('https://abc.clickhouse.cloud').port, 8443)
  assert.equal(clickhouse.parseDsn('http://ch.internal').port, 8123)
  assert.equal(clickhouse.parseDsn('https://ch.example.com:443').origin, 'https://ch.example.com:443')
  assert.equal(clickhouse.parseDsn('https://ch.example.com').user, 'default')
  assert.throws(() => clickhouse.parseDsn('https://u:p@ch.example.com/x?readonly=0'), { param: 'dsn' })
  assert.throws(() => clickhouse.parseDsn('clickhouse://u:p@ch.example.com:9000/x'), { param: 'dsn' })
  assert.throws(() => clickhouse.parseDsn('not a url'), { param: 'dsn' })
})

test('a query is sent with the limits, then readonly last, and the login in headers', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => answer(Array.from({ length: 1001 }, (_, n) => JSON.stringify({ n })).join('\n')))
  const result = JSON.parse((await call('query', { sql: 'select number as n from numbers(5000)' })).text) as { rows: unknown[]; truncated: boolean }
  assert.equal(result.rows.length, 1000)
  assert.equal(result.truncated, true)
  const [url, init] = fetch.mock.calls[0].arguments as [URL, RequestInit & { headers: Record<string, string> }]
  assert.equal(url.origin, 'https://203.0.113.7:8443')
  const settings = [...url.searchParams.entries()]
  assert.deepEqual(settings.at(-1), ['readonly', '1'])
  assert.equal(url.searchParams.get('max_execution_time'), '15')
  assert.equal(url.searchParams.get('max_result_rows'), '1001')
  assert.equal(url.searchParams.get('result_overflow_mode'), 'break')
  assert.equal(url.searchParams.get('default_format'), 'JSONEachRow')
  assert.equal(init.body, 'select number as n from numbers(5000)')
  assert.deepEqual(init.headers, { 'x-clickhouse-user': 'reader', 'x-clickhouse-key': 'p@ss', 'x-clickhouse-database': 'logs' })
})

test('a user whose profile is already read-only gets the query again without the limits', async (t) => {
  const sent: URL[] = []
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    sent.push(url)
    return sent.length === 1 ? answer('Code: 164. DB::Exception: Cannot modify \'max_execution_time\' setting in readonly mode. (READONLY)', 500) : answer('{"c":2}\n')
  })
  assert.deepEqual(await clickhouse.query({ dsn: DSN, sql: 'select count() c from logs' }), { rows: [{ c: 2 }], truncated: false })
  assert.equal(sent[1].searchParams.get('max_execution_time'), null)
  assert.equal(sent[1].searchParams.get('readonly'), '1')
})

test('tables and describe pass names as query parameters, never in the SQL', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => answer(''))
  await call('tables', { database: 'x\' or 1=1 --' })
  const [tablesUrl, tablesInit] = fetch.mock.calls[0].arguments as [URL, RequestInit]
  assert.equal(tablesUrl.searchParams.get('param_database'), 'x\' or 1=1 --')
  assert.ok(!String(tablesInit.body).includes('1=1'))
  await assert.rejects(call('describe', { table: 'events' }), /No table named events/)
  const [describeUrl] = fetch.mock.calls[1].arguments as [URL]
  assert.equal(describeUrl.searchParams.get('param_table'), 'events')
  assert.equal(describeUrl.searchParams.get('param_database'), '')
})

test('a ClickHouse error comes back as its message, without the code or version', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => answer('Code: 60. DB::Exception: Unknown table expression identifier \'nope\'. (UNKNOWN_TABLE) (version 25.8.33.6 (official build))', 404))
  await assert.rejects(clickhouse.query({ dsn: DSN, sql: 'select * from nope' }), { message: 'Unknown table expression identifier \'nope\'. (UNKNOWN_TABLE)' })
})

test('the check on save names a wrong password plainly', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => answer('Code: 516. DB::Exception: reader: Authentication failed: password is incorrect. (AUTHENTICATION_FAILED) (version 25.8)', 516))
  await assert.rejects(clickhouse.probe(DSN), { param: 'dsn', message: 'ClickHouse turned down reader. Check the user name and password.' })
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => answer('{"1":1}\n'))
  assert.equal(await clickhouse.probe(DSN), '203.0.113.7/logs')
})

test('loopback, link-local and agent addresses are refused', async () => {
  for (const host of ['127.0.0.1', '169.254.169.254', '10.200.4.1', 'localhost']) {
    await assert.rejects(clickhouse.query({ dsn: `http://${host}:8123`, sql: 'select 1' }), /^Error: Refused address/)
  }
})
