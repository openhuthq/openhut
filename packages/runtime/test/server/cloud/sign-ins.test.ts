import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../../../src/server/platform/db.ts'
import { hinted, SIGN_IN_MS, takeSignIn, withSignIn } from '../../../src/server/cloud/sign-ins.ts'

await migrate()

test('a sign-in started in the last 15 minutes finishes once; an older or unknown one has expired', () => {
  const now = Date.now()
  const pending = withSignIn({ pending: { old: now - SIGN_IN_MS - 1, other: now - 1000 }, state: 'mine', now })
  assert.deepEqual(Object.keys(pending).sort(), ['mine', 'other'])
  const taken = takeSignIn({ pending, state: 'mine', now: now + 60_000 })
  assert.equal(taken.started, true)
  assert.deepEqual(Object.keys(taken.rest), ['other'])
  assert.equal(takeSignIn({ pending: taken.rest, state: 'mine', now }).started, false)
  assert.equal(takeSignIn({ pending, state: 'mine', now: now + SIGN_IN_MS }).started, false)
})

test('pending sign-ins are kept in the database, so a runtime restart between Continue with Google and the callback still signs you in', async () => {
  const { settings } = await import('../../../src/server/platform/settings.ts')
  const { db } = await import('../../../src/server/platform/db.ts')
  await settings.setSignIns({ abc: 123 })
  const row = await db.selectFrom('install_setting').select('value').where('name', '=', 'sign_ins').executeTakeFirst()
  assert.deepEqual(JSON.parse(row?.value ?? '{}'), { abc: 123 })
  assert.deepEqual(settings.signIns(), { abc: 123 })
})

test('the email an invite went to rides along to Google as login_hint, so the right account comes first', () => {
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y'
  assert.equal(hinted({ url }), url)
  assert.equal(new URL(hinted({ url, loginHint: 'ana+team@example.com' })).searchParams.get('login_hint'), 'ana+team@example.com')
  assert.equal(new URL(hinted({ url, loginHint: 'ana@example.com' })).searchParams.get('state'), 'y')
})
