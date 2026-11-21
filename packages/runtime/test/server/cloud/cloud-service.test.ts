import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

const account = { signer: undefined as string | undefined, boxes: new Map<string, { body: string; by: string; signature: string }>(), hideWorkspaces: false }
let authorization = ''
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string> : {}
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const keep = (name: string, box: { body: string; by: string; signature: string }) => {
    if (account.signer && account.signer !== box.by) return reply(403, { error: { type: 'permission_error', message: 'Only your account key can replace your key boxes.' } })
    account.signer ??= box.by
    account.boxes.set(name, box)
    return reply(200, box)
  }
  if (req.url === '/v1/oauth-authorizations') {
    authorization = body.state ?? ''
    return reply(200, { id: 'sealed-authorization', object: 'oauth_authorization', provider: 'google', authorizationUrl: 'https://accounts.example/auth', expiresAt: new Date().toISOString() })
  }
  if (req.url === '/v1/sessions') return reply(200, { object: 'cloud_session', token: 'session-token', sub: 'dev-sara', email: 'sara@example.com', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  if (req.url === '/v1/workspaces' && req.method === 'GET') {
    const data = account.hideWorkspaces ? [] : [...account.boxes].filter(([name]) => name.startsWith('workspace/')).map(([name, box]) => ({ id: name.slice(10), object: 'workspace', key: box.body, by: box.by, signature: box.signature }))
    return reply(200, { object: 'list', data })
  }
  if (req.url === '/v1/workspaces') return keep(`workspace/${body.id}`, { body: body.key ?? '', by: body.by ?? '', signature: body.signature ?? '' })
  if (req.url === '/v1/key-boxes/kit' && req.method === 'GET') {
    const kit = account.boxes.get('kit')
    return kit ? reply(200, { object: 'key_box', kind: 'kit', ...kit }) : reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
  }
  reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
})
cloud.listen(0, '127.0.0.1')
await once(cloud, 'listening')
const address = cloud.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
await migrate()

async function signIn(): Promise<string> {
  await cloudService.start()
  return cloudService.finish({ state: authorization, code: 'code' })
}

test('a second Mac signing in to an account another Mac made goes to Welcome back instead of making a second workspace', async () => {
  const otherMac = { body: 'locked-by-the-first-mac', by: 'first-macs-account-key', signature: 'signed' }
  account.signer = otherMac.by
  account.boxes.set('workspace/ws_firstmac', otherMac)
  assert.match(await signIn(), /You’re signed in/)
  assert.equal((await cloudService.status()).status, 'locked')
  assert.equal(keysService.account(), undefined)
  assert.deepEqual([...account.boxes.keys()], ['workspace/ws_firstmac'])
  await assert.rejects(cloudService.unlock({ words: Array.from({ length: 12 }, () => 'abandon') }), (err: Error & { status?: number }) => err.status === 409 && /no recovery kit for this account yet/.test(err.message))
  await cloudService.signOut()
})

test('when both Macs sign in at once, the one whose workspace box the cloud refuses unlocks instead of keeping its own account', async () => {
  account.hideWorkspaces = true
  assert.match(await signIn(), /You’re signed in/)
  assert.equal((await cloudService.status()).status, 'locked')
  assert.equal(keysService.account(), undefined)
  assert.equal(keysService.locked()?.email, 'sara@example.com')
  assert.deepEqual([...account.boxes.keys()], ['workspace/ws_firstmac'])
  cloud.close()
})
