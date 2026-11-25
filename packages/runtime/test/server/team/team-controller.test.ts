import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { listenLocally } from '../../../src/server/team/identity.ts'
import { inviteController, meController, peopleController, securityController, sessionController, setupCodeController } from '../../../src/server/team/team-controller.ts'

await migrate()
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
await app.register(meController, { prefix: '/api/me' })
await app.register(setupCodeController, { prefix: '/api/setup-codes' })
await app.register(peopleController, { prefix: '/api/people' })
await app.register(sessionController, { prefix: '/api/sessions' })
await app.register(inviteController, { prefix: '/api/invites' })
await app.register(securityController, { prefix: '/api/settings/security' })
await app.listen({ port: 0, host: '127.0.0.1' })
const socket = `${config.dataDir}/team.sock`
const local = await listenLocally({ server: app.server, path: socket })
test.after(async () => { local.close(); await app.close() })

const PASSWORD = 'correct horse battery'
let ip = 0
const call = async ({ method = 'GET', url, body, cookie, from = `10.0.0.${++ip}` }: { method?: string; url: string; body?: object; cookie?: string; from?: string }) => {
  const res = await app.inject({ method: method as 'GET', url, payload: body, headers: cookie ? { cookie } : {}, remoteAddress: from })
  return { status: res.statusCode, body: res.json(), cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] }
}
const mintCode = () => new Promise<string>((resolve, reject) => {
  request({ socketPath: socket, path: '/api/setup-codes', method: 'POST' }, (res) => {
    let raw = ''
    res.on('data', (chunk) => { raw += chunk }).on('end', () => resolve(JSON.parse(raw).code))
  }).on('error', reject).end()
})
let owner = ''

test('the setup code comes only from the server\'s own socket, and two visitors racing with it make one owner', async () => {
  assert.equal((await call({ method: 'POST', url: '/api/setup-codes' })).status, 403)
  const code = await mintCode()
  assert.match(code, /^([A-Z2-9]{4}-){6}[A-Z2-9]{4}$/)
  assert.equal((await call({ method: 'POST', url: '/api/people', body: { setupCode: 'WRONG-CODE', email: 'x@example.com', password: PASSWORD } })).status, 403)
  const race = await Promise.all(['a@example.com', 'b@example.com'].map((email) => call({ method: 'POST', url: '/api/people', body: { setupCode: code.toLowerCase(), email, password: PASSWORD } })))
  assert.deepEqual(race.map((each) => each.status).sort(), [200, 403])
  const winner = race.find((each) => each.status === 200)
  assert.equal(winner?.body.role, 'owner')
  assert.match(winner?.cookie ?? '', /^openhut_session=ohs_/)
  owner = winner?.cookie ?? ''
  assert.equal((await db.selectFrom('person').select('id').where('role', '=', 'owner').execute()).length, 1)
  assert.equal((await call({ method: 'POST', url: '/api/people', body: { setupCode: code, email: 'c@example.com', password: PASSWORD } })).status, 403)
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
  assert.equal((await call({ method: 'PATCH', url: '/api/settings/security', body: { usageData: true }, cookie: member })).status, 403)
  assert.equal((await call({ method: 'PATCH', url: `/api/people/${mia}`, body: { role: 'admin' }, cookie: owner })).body.role, 'admin')
  assert.equal((await call({ method: 'POST', url: '/api/invites', body: { role: 'member' }, cookie: member })).status, 200)
  const ownerId = (await call({ url: '/api/me', cookie: owner })).body.user.id
  assert.equal((await call({ method: 'DELETE', url: `/api/people/${ownerId}`, cookie: member })).status, 404)
  assert.equal((await call({ method: 'DELETE', url: `/api/people/${mia}`, cookie: owner })).status, 200)
  assert.equal((await call({ url: '/api/me', cookie: member })).status, 401)
})
