import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocketServer } from 'ws'
import Fastify from 'fastify'

const seen: { state?: string; deviceKey?: string; members?: unknown; email: string; kit?: unknown; lists: unknown[]; workspaces: unknown[] } = { email: 'mo@example.com', lists: [], workspaces: [] }
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {}
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  if (req.url === '/v1/oauth-authorizations') {
    Object.assign(seen, { state: body.state, deviceKey: body.deviceKey })
    return reply(200, { id: 'sealed-authorization', object: 'oauth_authorization', provider: 'google', authorizationUrl: 'https://accounts.example/auth', expiresAt: new Date().toISOString() })
  }
  if (req.url === '/v1/sessions') return reply(body.deviceKey === seen.deviceKey ? 200 : 400, { object: 'cloud_session', token: 'session-token', sub: `dev-${seen.email}`, email: seen.email, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  if (req.url === '/v1/key-boxes/kit' && req.method === 'PUT') return reply(200, seen.kit = { object: 'key_box', kind: 'kit', body: body.body })
  if (req.url === '/v1/key-boxes/kit') return seen.kit ? reply(200, seen.kit) : reply(404, {})
  if (req.url === '/v1/workspaces' && req.method === 'POST') return reply(200, seen.workspaces[0] = body)
  if (req.url === '/v1/workspaces') return reply(200, { object: 'list', data: seen.workspaces })
  if (req.url?.includes('/member-lists')) return reply(200, { object: 'list', data: seen.lists })
  if (req.url?.endsWith('/members') && req.method === 'GET') return seen.members ? reply(200, seen.members) : reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
  if (req.url?.endsWith('/members') && req.method === 'PUT') return reply(200, seen.members = seen.lists[seen.lists.length] = body)
  reply(404, {})
})
new WebSocketServer({ server: cloud }).on('connection', (ws) => ws.on('message', (data) => {
  if (JSON.parse(String(data)).token === 'session-token') ws.send(JSON.stringify({ type: 'ready', version: 1 }))
}))
cloud.listen(0, '127.0.0.1')
await once(cloud, 'listening')
const address = cloud.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
await migrate()

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
await app.register(cloudController, { prefix: '/api/cloud' })
const headers = { authorization: 'Bearer test-key' }
const status = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json() as { status: string; email: string | null; workspace: { members: { email: string; role: string }[] } | null; kit: { savedAt: string } | null; signInError: string | null; keptAccount: string | null; device: string }
const signIn = async (email: string) => {
  seen.email = email
  await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })
  return (await app.inject({ method: 'GET', url: `/api/cloud/callback?state=${seen.state}&code=c` })).body
}
const until = async (want: string) => {
  for (let i = 0; i < 50 && (await status()).status !== want; i++) await sleep(50)
  return status()
}
after(() => cloud.close())

test('/api/cloud is off until sign-in, and off again after sign-out', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/cloud' })).statusCode, 401)
  assert.equal((await status()).status, 'off')
  const started = await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers, })
  assert.equal(started.json().authorizationUrl, 'https://accounts.example/auth')
  assert.equal((await status()).status, 'off')

  const forged = await app.inject({ method: 'GET', url: '/api/cloud/callback?state=forged&code=c' })
  assert.match(forged.body, /This sign-in expired\. Go back to OpenHut and try again\./)
  const back = await app.inject({ method: 'GET', url: `/api/cloud/callback?state=${seen.state}&code=c` })
  assert.match(back.headers['content-type'] ?? '', /^text\/html/)
  assert.match(back.body, /You’re signed in\. You can go back to OpenHut\./)
  for (let i = 0; i < 50 && (await status()).status !== 'on'; i++) await sleep(50)
  const on = await status()
  assert.equal(on.status, 'on')
  assert.equal(on.email, 'mo@example.com')
  assert.deepEqual(on.workspace?.members.map((member) => [member.email, member.role]), [['mo@example.com', 'owner']])
  assert.ok(seen.members)

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().status, 'off')
  const off = await status()
  assert.equal(off.status, 'off')
  assert.equal(off.workspace, null)
})

test('a downloaded kit is saved at once, a second account gets its sentence and a way out, and the words restore after forgetting', async () => {
  await signIn('mo@example.com')
  assert.equal((await until('on')).kit, null)
  const kit = (await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).json() as { words: string[] }
  assert.equal(kit.words.length, 12)
  assert.ok((await status()).kit?.savedAt)
  assert.ok(seen.kit)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 409)
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  assert.equal((await status()).keptAccount, 'mo@example.com')

  assert.match(await signIn('sara@example.com'), /signed in to mo@example\.com/)
  const refused = await status()
  assert.equal(refused.status, 'off')
  assert.match(refused.signInError ?? '', /signed in to mo@example\.com/)
  const forgot = (await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).json() as { keptAccount: string | null; signInError: string | null; device: string }
  assert.deepEqual([forgot.keptAccount, forgot.signInError], [null, null])
  assert.notEqual(forgot.device, refused.device)

  await signIn('mo@example.com')
  assert.equal((await status()).status, 'locked')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { words: kit.words } })).statusCode, 200)
  const back = await until('on')
  assert.equal(back.email, 'mo@example.com')
  assert.equal(seen.lists.length, 2)
})
