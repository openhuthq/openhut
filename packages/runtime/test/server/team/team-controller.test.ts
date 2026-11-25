import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { inviteController, meController, peopleController, installSettingsController, sessionController } from '../../../src/server/team/team-controller.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
await app.register(meController, { prefix: '/api/me' })
await app.register(peopleController, { prefix: '/api/people' })
await app.register(sessionController, { prefix: '/api/sessions' })
await app.register(inviteController, { prefix: '/api/invites' })
await app.register(installSettingsController, { prefix: '/api/install-settings' })
await app.ready()
test.after(() => app.close())

const PASSWORD = 'correct horse battery'
let ip = 0
const call = async ({ method = 'GET', url, body, cookie, from = `10.0.0.${++ip}` }: { method?: string; url: string; body?: object; cookie?: string; from?: string }) => {
  const res = await app.inject({ method: method as 'GET', url, payload: body, headers: cookie ? { cookie } : {}, remoteAddress: from })
  return { status: res.statusCode, body: res.json(), cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] }
}
let owner = ''

test('while there is no owner, the first visitor becomes it; two racing visitors make one owner, and owner sign-up then closes', async () => {
  const body = (email: string) => ({ address: 'https://agents.example.com', email, password: PASSWORD })
  const race = await Promise.all(['a@example.com', 'b@example.com'].map((email) => call({ method: 'POST', url: '/api/people', body: body(email) })))
  assert.deepEqual(race.map((each) => each.status).sort(), [200, 409])
  const winner = race.find((each) => each.status === 200)
  assert.equal(winner?.body.role, 'owner')
  assert.match(winner?.cookie ?? '', /^openhut_session=ohs_/)
  owner = winner?.cookie ?? ''
  assert.equal((await db.selectFrom('person').select('id').where('role', '=', 'owner').execute()).length, 1)
  assert.equal((await call({ method: 'POST', url: '/api/people', body: body('c@example.com') })).status, 409)
  assert.equal((await call({ url: '/api/me', cookie: owner })).status, 200)
  assert.equal((await call({ url: '/api/me' })).status, 401)
})

test('sign-in is rate limited per address and per email', async () => {
  const email = (await call({ url: '/api/me', cookie: owner })).body.user.email
  const tries = []
  for (let i = 0; i < 11; i++) tries.push((await call({ method: 'POST', url: '/api/sessions', body: { email, password: 'wrong password!' }, from: '10.9.9.9' })).status)
  assert.deepEqual([tries[0], tries[10]], [401, 429])
  assert.equal((await call({ method: 'POST', url: '/api/sessions', body: { email, password: PASSWORD } })).status, 429)
  assert.equal((await call({ method: 'POST', url: '/api/sessions', body: { email: 'nobody@example.com', password: PASSWORD }, from: '10.9.9.9' })).status, 429)
})

test('an invite link works once, and not after it expires', async () => {
  const { body: invite } = await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: owner })
  const token = invite.link.split('/invite/')[1]
  assert.equal((await call({ url: `/api/invites/${token}` })).body.role, 'member')
  const joined = await call({ method: 'POST', url: '/api/people', body: { inviteToken: token, name: 'Mia', email: 'mia@example.com', password: PASSWORD } })
  assert.deepEqual([joined.status, joined.body.role, joined.body.name], [200, 'member', 'Mia'])
  assert.equal((await call({ method: 'POST', url: '/api/people', body: { inviteToken: token, name: 'Eve', email: 'eve@example.com', password: PASSWORD } })).status, 410)
  const { body: late } = await call({ method: 'POST', url: '/api/invites', body: { role: 'admin' }, cookie: owner })
  await db.updateTable('invite').set({ expires_at: new Date(Date.now() - 1000) }).execute()
  const lateToken = late.link.split('/invite/')[1]
  assert.equal((await call({ url: `/api/invites/${lateToken}` })).status, 410)
  assert.equal((await call({ method: 'POST', url: '/api/people', body: { inviteToken: lateToken, name: 'Eve', email: 'eve@example.com', password: PASSWORD } })).status, 410)
})

test('roles are enforced on the server: a member can\'t invite, change roles or see security; an admin can', async () => {
  const member = (await call({ method: 'POST', url: '/api/sessions', body: { email: 'mia@example.com', password: PASSWORD } })).cookie
  const mia = (await call({ url: '/api/me', cookie: member })).body.user.id
  assert.equal((await call({ method: 'POST', url: '/api/invites', body: { role: 'admin' }, cookie: member })).status, 403)
  assert.equal((await call({ method: 'PATCH', url: `/api/people/${mia}`, body: { role: 'admin' }, cookie: member })).status, 403)
  assert.equal((await call({ method: 'PATCH', url: '/api/install-settings', body: { usageData: true }, cookie: member })).status, 403)
  assert.equal((await call({ method: 'PATCH', url: `/api/people/${mia}`, body: { role: 'admin' }, cookie: owner })).body.role, 'admin')
  assert.equal((await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: member })).status, 200)
  const ownerId = (await call({ url: '/api/me', cookie: owner })).body.user.id
  assert.equal((await call({ method: 'DELETE', url: `/api/people/${ownerId}`, cookie: member })).status, 404)
  assert.equal((await call({ method: 'DELETE', url: `/api/people/${mia}`, cookie: owner })).status, 200)
  assert.equal((await call({ url: '/api/me', cookie: member })).status, 401)
})

test('admins see pending invite links and revoke them; a member can\'t; a removed person\'s email can be invited back', async () => {
  const member = (await call({ method: 'POST', url: '/api/people', body: { inviteToken: (await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: owner })).body.link.split('/invite/')[1], name: 'Sam', email: 'sam@example.com', password: PASSWORD } })).cookie
  const { body: invite } = await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: owner })
  const token = invite.link.split('/invite/')[1]
  const pending = (await call({ url: '/api/invites', cookie: owner })).body.data
  assert.ok(pending.some((each: { id: string; link?: string }) => each.id === invite.id && !each.link))
  assert.equal((await call({ url: '/api/invites', cookie: member })).status, 403)
  assert.equal((await call({ method: 'DELETE', url: `/api/invites/${invite.id}`, cookie: member })).status, 403)
  assert.equal((await call({ method: 'DELETE', url: `/api/invites/${invite.id}`, cookie: owner })).status, 200)
  assert.equal((await call({ url: `/api/invites/${token}` })).status, 410)
  const again = (await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: owner })).body.link.split('/invite/')[1]
  const back = await call({ method: 'POST', url: '/api/people', body: { inviteToken: again, name: 'Mia', email: 'mia@example.com', password: PASSWORD } })
  assert.deepEqual([back.status, back.body.email], [200, 'mia@example.com'])
})
