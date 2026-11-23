import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { postgres } from '../../../../src/server/integrations/postgres/postgres.ts'

test('only sslmode is allowed in the connection string, so it can\'t move the host or read local files', () => {
  assert.throws(() => postgres.parseDsn('postgres://u:p@db.example.com/x?host=127.0.0.1'), { param: 'dsn' })
  assert.throws(() => postgres.parseDsn('postgres://u:p@db.example.com/x?sslrootcert=/etc/passwd'), { param: 'dsn' })
  assert.throws(() => postgres.parseDsn('mysql://u:p@db.example.com/x'), { param: 'dsn' })
  assert.throws(() => postgres.parseDsn('postgres://u:p@db.example.com/x?sslmode=bogus'), { param: 'dsn' })
})

test('sslmode keeps libpq\'s meanings, with prefer as the default', () => {
  assert.deepEqual(postgres.parseDsn('postgres://u:p@db.example.com/x').sslAttempts, [{ rejectUnauthorized: false }, false])
  assert.deepEqual(postgres.parseDsn('postgres://u:p@db.example.com/x?sslmode=disable').sslAttempts, [false])
  assert.deepEqual(postgres.parseDsn('postgres://u:p@db.example.com/x?sslmode=verify-full').sslAttempts, [{ rejectUnauthorized: true }])
})

test('the address guard refuses loopback, this host, link-local and agent networks, mapped forms too', async () => {
  for (const host of ['127.0.0.1', '[::ffff:127.0.0.1]', '169.254.169.254', '10.200.4.1', '0.0.0.0', '[::1]', 'localhost']) {
    await assert.rejects(postgres.query({ dsn: `postgres://u:p@${host}/x`, sql: 'select 1' }), /^Error: Refused address/)
  }
})

test('explain shows the plan in a read-only transaction, after the superuser check, and never runs ANALYZE', async (t) => {
  const sent: string[] = []
  t.mock.method(pg.Client.prototype, 'connect', async () => undefined)
  t.mock.method(pg.Client.prototype, 'end', async () => undefined)
  t.mock.method(pg.Client.prototype, 'query', async (query: string | { text: string }) => {
    const text = typeof query === 'string' ? query : query.text
    sent.push(text)
    if (text.includes('as risky')) return { rows: [{ risky: false }] }
    if (text.startsWith('explain (format json)')) return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan' } }] }] }
    if (text.startsWith('explain')) return { rows: [{ 'QUERY PLAN': 'Seq Scan on orders' }, { 'QUERY PLAN': '  Filter: (id = 1)' }] }
    return { rows: [] }
  })
  const dsn = 'postgres://u:p@203.0.113.7/x'
  assert.deepEqual(await postgres.explain({ dsn, sql: 'select * from orders where id = 1' }), { plan: 'Seq Scan on orders\n  Filter: (id = 1)' })
  assert.deepEqual(sent.slice(1), ['begin read only', 'explain (format text) select * from orders where id = 1', 'rollback'])
  assert.deepEqual(await postgres.explain({ dsn, sql: 'select 1', format: 'json' }), { plan: [{ Plan: { 'Node Type': 'Seq Scan' } }] })
  sent.length = 0
  await assert.rejects(postgres.explain({ dsn, sql: 'explain analyze select 1' }), /without EXPLAIN/)
  await assert.rejects(postgres.explain({ dsn, sql: 'select 1 from (select 1) analyse' }), /ANALYZE runs the query/)
  assert.deepEqual(sent, [])
})

test('explain still refuses a superuser login', async (t) => {
  t.mock.method(pg.Client.prototype, 'connect', async () => undefined)
  t.mock.method(pg.Client.prototype, 'end', async () => undefined)
  const query = t.mock.method(pg.Client.prototype, 'query', async () => ({ rows: [{ risky: true }] }))
  await assert.rejects(postgres.explain({ dsn: 'postgres://u:p@203.0.113.7/x', sql: 'select 1' }), /logs in as a superuser/)
  assert.ok(!query.mock.calls.some((call) => String(call.arguments[0]).startsWith('explain')))
})
