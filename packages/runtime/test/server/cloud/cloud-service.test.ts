import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, identity, toBase64 } from '@openhut/common/vault/vault.ts'

const account = { signer: undefined as string | undefined, boxes: new Map<string, { body: string; by: string; signature: string }>(), hideWorkspaces: false, failSigners: 0 }
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
  const kind = /^\/v1\/key-boxes\/(kit|kit-confirmed|passkey)$/.exec(req.url ?? '')?.[1]
  if (kind && req.method === 'GET') {
    const box = account.boxes.get(kind)
    return box ? reply(200, { object: 'key_box', kind, ...box }) : reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
  }
  if (kind && req.method === 'PUT') return keep(kind, { body: body.body ?? '', by: body.by ?? '', signature: body.signature ?? '' })
  if (kind && req.method === 'DELETE') {
    if (body.by !== account.signer) return reply(403, { error: { type: 'permission_error', message: 'Only your account key can delete your key boxes.' } })
    account.boxes.delete(kind)
    return reply(200, { object: 'key_box', kind, deleted: true })
  }
  if (req.url === '/v1/signers') {
    if (account.failSigners-- > 0) return reply(503, { error: { type: 'api_error', message: 'busy' } })
    if (body.by !== account.signer && body.next !== account.signer) return reply(403, { error: { type: 'permission_error', message: 'Only your current account key can hand your key boxes to a new one.' } })
    account.signer = body.next
    return reply(200, { object: 'signer', key: body.next })
  }
  if (/^\/v1\/workspaces\/[^/]+\/(members|letters)$/.test(req.url ?? '') && req.method !== 'GET') return reply(200, body)
  reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
})
cloud.listen(0, '127.0.0.1')
await once(cloud, 'listening')
const address = cloud.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
const { accountDevice, keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
await migrate()
after(() => cloud.close())

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
})

test('a Not me whose signer handover fails once is kept and finished later: Make a new kit then works and the old boxes are gone', async () => {
  await keysService.setLocked(undefined)
  Object.assign(account, { signer: undefined, hideWorkspaces: false })
  account.boxes.clear()
  const first = await keysService.open({ sub: 'dev-sara', email: 'sara@example.com' })
  await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const kitOf = async () => toBase64((await accountDevice(fromBase64(keysService.account()?.key ?? ''))).publicKey)
  const oldKit = await kitOf()
  const box = await keysService.workspaceBox(first)
  account.boxes.set(`workspace/${box.id}`, { body: box.key, by: box.by, signature: box.signature })
  await cloudService.newKit()
  account.boxes.set('passkey', { body: 'old-passkey', by: oldKit, signature: 'signed' })
  assert.equal(account.signer, oldKit)
  const stolen = await identity()
  const body = roomKeys.members()
  assert.ok(body)
  const at = Date.now()
  const mine = body.members[0]
  await roomKeys.advance({ lists: [await signList({ signer: await keysService.device(), body: { ...body, version: 2, previous: await anchorOf(first.list), at, members: [{ ...mine, devices: [...mine.devices, toBase64(stolen.publicKey)] }], added: { ...body.added, [toBase64(stolen.publicKey)]: at } } })] })
  account.failSigners = 1
  await assert.rejects(cloudService.notMe({ device: toBase64(stolen.publicKey) }), (err: Error & { status?: number }) => err.status === 502 && /tries again/.test(err.message))
  assert.equal(account.signer, oldKit)
  assert.deepEqual(keysService.moves().map((move) => `${move.method} ${move.path}`), ['POST /v1/signers', 'POST /v1/workspaces', 'DELETE /v1/key-boxes/kit', 'DELETE /v1/key-boxes/kit-confirmed', 'DELETE /v1/key-boxes/passkey'])
  const kit = await cloudService.newKit()
  const newKit = await kitOf()
  assert.equal(kit.words.length, 12)
  assert.notEqual(newKit, oldKit)
  assert.equal(account.signer, newKit)
  assert.deepEqual(keysService.moves(), [])
  assert.deepEqual([...account.boxes].map(([name, each]) => [name, each.by]).sort(), [['kit', newKit], ['kit-confirmed', newKit], [`workspace/${box.id}`, newKit]])
})
