import { test } from 'node:test'
import assert from 'node:assert/strict'
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
