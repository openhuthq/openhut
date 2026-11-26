import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../../../src/server/connections/redact.ts'

test('secret-looking values are hidden before the agent sees them', () => {
  const cluster = JSON.stringify({ name: 'prod-db', connection: { uri: 'postgresql://doadmin:s3cret@db.example.com:25060/defaultdb', password: 's3cret', user: 'doadmin' }, private_key: '-----BEGIN', api_token: 'dop_v1_x', size: 2 }, null, 2)
  const hidden = redact(cluster)
  assert.doesNotMatch(hidden, /s3cret|BEGIN|dop_v1/)
  assert.match(hidden, /"password": "\[hidden\]"/)
  assert.match(hidden, /postgresql:\/\/doadmin:\[hidden\]@db\.example\.com/)
  assert.match(hidden, /"name": "prod-db"/)
  assert.equal(redact('client_secret: abc\nhost: x'), 'client_secret: [hidden]\nhost: x')
  assert.equal(redact('Connection_String=Server=x;Password=y'), 'Connection_String=[hidden]')
  assert.equal(redact('no secrets here'), 'no secrets here')
})
