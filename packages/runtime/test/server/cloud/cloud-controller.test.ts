import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocketServer } from 'ws'
import Fastify from 'fastify'
import { fromBase64, identity, lock, newWords, toBase64 } from '@openhut/common/vault/vault.ts'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { checkProof } from '@openhut/common/cloud/cloud.ts'

const seen: { state?: string; deviceKey?: string; refreshed: number; members?: unknown; email: string; kit?: unknown; passkey?: unknown; lists: unknown[]; workspaces: unknown[]; failKit?: boolean; dropKit?: boolean; refuseBox?: boolean; confirmed?: unknown; cut?: boolean; down?: boolean; failDelete?: boolean } = { email: 'mo@example.com', lists: [], workspaces: [], refreshed: 0 }
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {}
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  if (req.url === '/v1/auth/sign-in/social') {
    Object.assign(seen, { state: body.state, deviceKey: body.device })
    return reply(200, { url: 'https://accounts.example/auth', redirect: false })
  }
  if (req.url === '/v1/auth/openhut/session') {
    const signed = await checkProof({ device: seen.deviceKey ?? '', proof: 'session', parts: [String(body.code)], signature: String(body.signature) })
    return reply(signed ? 200 : 400, { object: 'cloud_session', token: 'session-token', refresh: 'refresh-token', sub: `dev-${seen.email}`, email: seen.email, expiresAt: new Date(Date.now() + 60_000).toISOString() })
  }
  if (req.url === '/v1/auth/openhut/token') {
    const signed = body.session === 'refresh-token' && await checkProof({ device: seen.deviceKey ?? '', proof: 'refresh', parts: ['refresh-token', String(body.signedAt)], signature: String(body.signature) })
    if (signed) seen.refreshed++
    return reply(signed ? 200 : 401, { object: 'cloud_session', token: 'session-token', refresh: 'refresh-token', sub: `dev-${seen.email}`, email: seen.email, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  }
  if (seen.down && req.url?.startsWith('/v1/key-boxes/kit')) return req.socket.destroy()
  if (req.url === '/v1/key-boxes/kit' && req.method === 'PUT' && seen.cut) {
    seen.down = true
    return req.socket.destroy()
  }
  if (req.url === '/v1/key-boxes/kit' && req.method === 'PUT') {
    seen.kit = { object: 'key_box', kind: 'kit', body: body.body, by: body.by, signature: body.signature, savedAt: new Date(Number(body.savedAt)).toISOString() }
    if (seen.dropKit) return req.socket.destroy()
    return seen.failKit ? reply(502, {}) : reply(200, seen.kit)
  }
  if (req.url === '/v1/key-boxes/passkey' && req.method === 'DELETE') return reply(200, { object: 'key_box', kind: 'passkey', deleted: true, passkey: seen.passkey = undefined })
  if (req.url === '/v1/key-boxes/kit' && req.method === 'DELETE') return seen.failDelete ? reply(500, {}) : reply(200, { kind: 'kit', deleted: !(seen.kit = undefined) })
  if (req.url === '/v1/key-boxes/kit-confirmed' && req.method === 'PUT') return reply(200, seen.confirmed = { object: 'key_box', kind: 'kit-confirmed', body: body.body, by: body.by, signature: body.signature, savedAt: new Date(Number(body.savedAt)).toISOString() })
  if (req.url === '/v1/key-boxes/kit-confirmed' && req.method === 'DELETE') return reply(200, { kind: 'kit-confirmed', deleted: !(seen.confirmed = undefined) })
  if (req.url === '/v1/key-boxes/kit-confirmed') return seen.confirmed ? reply(200, seen.confirmed) : reply(404, {})
  if (req.url === '/v1/key-boxes/kit') return seen.kit ? reply(200, seen.kit) : reply(404, {})
  if (req.url === '/v1/key-boxes' && req.method === 'DELETE') {
    if (seen.kit) return reply(409, { error: { type: 'invalid_request_error', message: 'kit' } })
    Object.assign(seen, { workspaces: [], members: undefined, lists: [] })
    return reply(200, { object: 'list', data: [] })
  }
  if (req.url === '/v1/key-boxes/passkey' && req.method === 'PUT') return reply(200, seen.passkey = { object: 'key_box', kind: 'passkey', body: body.body, by: body.by, signature: body.signature })
  if (req.url === '/v1/key-boxes/passkey' && req.method === 'GET') return seen.passkey ? reply(200, seen.passkey) : reply(404, {})
  if (req.url === '/v1/workspaces' && req.method === 'POST') return seen.refuseBox ? reply(403, {}) : reply(200, seen.workspaces[0] = body)
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
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
await migrate()

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
await app.register(cloudController, { prefix: '/api/cloud' })
const headers = { authorization: 'Bearer test-key' }
const status = async () => (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json() as { status: string; email: string | null; workspace: { members: { email: string; role: string }[] } | null; kit: { savedAt: string; differs: boolean } | null; signInError: string | null; keptAccount: string | null; kitInCloud: boolean; passkey: boolean; device: string; needsSignIn: boolean }
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
const kitOf = async (account: { sub: string; key: string }) => {
  const { words, key } = await newWords()
  return { words, box: toBase64(await lock({ key, version: 1, bind: `account/${account.sub}/kit`, plain: fromBase64(account.key) }) ?? new Uint8Array()) }
}

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
  assert.ok(seen.refreshed > 0, 'a session near its hour refreshes with this device’s signature')
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
  assert.equal((seen.confirmed as { body: string }).body, (seen.kit as { body: string }).body)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 409)
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  assert.equal((await status()).keptAccount, 'mo@example.com')

  assert.match(await signIn('sara@example.com'), /is set up for mo@example\.com\. Sign in with that account, or forget it below\./)
  const refused = await status()
  assert.equal(refused.status, 'off')
  assert.match(refused.signInError ?? '', /is set up for mo@example\.com/)
  const forgot = (await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).json() as { keptAccount: string | null; signInError: string | null; device: string }
  assert.deepEqual([forgot.keptAccount, forgot.signInError], [null, null])
  assert.notEqual(forgot.device, refused.device)

  await signIn('mo@example.com')
  assert.equal((await status()).status, 'locked')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { words: kit.words } })).statusCode, 200)
  const back = await until('on')
  assert.equal(back.email, 'mo@example.com')
  assert.equal(seen.lists.length, 2)
  assert.ok(back.kit?.savedAt)
})

test('a new kit the cloud kept but didn’t confirm leaves no kit, not the retired one', async () => {
  assert.ok((await status()).kit)
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })
  Object.assign(seen, { members: undefined, kit: undefined, lists: [], workspaces: [] })
  await signIn('ana@example.com')
  await until('on')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 200)
  const before = seen.lists.length
  seen.failKit = true
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 502)
  seen.failKit = false
  assert.equal(seen.lists.length, before + 1)
  assert.equal((await status()).kit, null)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, null)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 409)
})

test('signed in, the Mac compares its kit box with the cloud’s: another box clears the local kit and warns until a new kit is made', async () => {
  await signIn('ana@example.com')
  await until('on')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 200)
  const theirs = seen.kit as { signature: string }
  seen.kit = { object: 'key_box', kind: 'kit', body: (seen.workspaces[0] as { key: string }).key, by: (await status()).device, signature: theirs.signature }
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  await signIn('ana@example.com')
  let kit = (await until('on')).kit
  for (let i = 0; i < 50 && !kit?.differs; i++, await sleep(50)) kit = (await status()).kit
  assert.equal(kit?.differs, true)
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 200)
  assert.equal((await status()).kit?.differs, false)
})

test('a kit save whose answer is lost is taken back from the cloud, so the account’s other Mac never adopts words nobody saw', async () => {
  seen.dropKit = true
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 502)
  assert.deepEqual([seen.kit, keysService.kitState().pending, (await status()).kit], [undefined, null, null])
  seen.failDelete = true
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 502)
  Object.assign(seen, { dropKit: false, failDelete: false })
  const unseen = seen.kit as { body: string }
  assert.deepEqual([keysService.kitState().pending, (seen.confirmed as { body: string } | undefined)?.body === unseen.body], [unseen.body, false])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, null)
  assert.deepEqual([seen.kit, keysService.kitState().pending], [undefined, null])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 409)

  await signIn('ana@example.com')
  await until('on')
  const account = keysService.account()
  assert.ok(account)
  const made = await kitOf(account)
  const savedAt = Date.now()
  seen.kit = { object: 'key_box', kind: 'kit', ...await keysService.signBox({ account, name: 'kit', body: made.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, null)
  assert.deepEqual([keysService.kitState().saved, keysService.kitState().pending], [null, null])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 409)
  await signIn('ana@example.com')
  await until('on')
  seen.confirmed = { object: 'key_box', kind: 'kit-confirmed', ...await keysService.signBox({ account, name: 'kit-confirmed', body: made.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, 'ana@example.com')
  assert.equal(keysService.kitState().saved?.box, made.box)
  await signIn('ana@example.com')
  await until('on')
})

test('a kit stuck unconfirmed on a Mac that crashed mid-save gives way to the kit another Mac saves, so Forget works and its words restore', async () => {
  seen.cut = true
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 502)
  Object.assign(seen, { cut: false, down: false })
  assert.ok(keysService.kitState().pending)
  assert.notEqual((seen.kit as { body: string }).body, keysService.kitState().pending)
  const account = keysService.account()
  assert.ok(account)
  const theirs = await kitOf(account)
  const savedAt = Date.now()
  seen.kit = { object: 'key_box', kind: 'kit', ...await keysService.signBox({ account, name: 'kit', body: theirs.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  seen.confirmed = { object: 'key_box', kind: 'kit-confirmed', ...await keysService.signBox({ account, name: 'kit-confirmed', body: theirs.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, 'ana@example.com')
  assert.deepEqual([keysService.kitState().pending, keysService.kitState().saved?.box], [null, theirs.box])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 200)
  await signIn('ana@example.com')
  assert.equal((await status()).status, 'locked')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { words: theirs.words } })).statusCode, 200)
  assert.equal((await until('on')).kit?.savedAt, new Date(savedAt).toISOString())
})

test('after Start over on another Mac, this Mac locks and asks for the new kit instead of looping on Make a new kit', async () => {
  const theirs = { id: 'ws_theirs', key: 'dGhlaXJz', by: 'b', signature: 's' }
  const kept = seen.kit as { body: string; signature: string }
  seen.kit = { object: 'key_box', kind: 'kit', body: kept.body, by: (await status()).device, signature: kept.signature }
  seen.workspaces = [theirs]
  cloudService.connect()
  const locked = await until('locked')
  assert.deepEqual([locked.status, locked.kitInCloud, keysService.account()], ['locked', true, undefined])
  seen.kit = undefined
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/key-boxes', headers })).statusCode, 200)
  await until('on')
  Object.assign(seen, { workspaces: [theirs], refuseBox: true })
  cloudService.connect()
  const relocked = await until('locked')
  assert.deepEqual([relocked.status, relocked.kitInCloud, keysService.account()], ['locked', false, undefined])
  seen.refuseBox = false
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/key-boxes', headers })).statusCode, 200)
  await until('on')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 200)
})

test('a passkey’s PRF output locks the account key in the room; on a new Mac the same PRF unlocks it and a different one doesn’t', async () => {
  const prf = Buffer.alloc(32, 7).toString('base64url')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/passkeys', headers, payload: { prf: 'short' } })).statusCode, 400)
  const added = await app.inject({ method: 'POST', url: '/api/cloud/passkeys', headers, payload: { prf } })
  assert.equal(added.statusCode, 200)
  assert.equal(added.json().passkey, true)
  assert.equal(JSON.stringify(seen.passkey).includes(prf), false)
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })
  await signIn('ana@example.com')
  assert.deepEqual([(await status()).status, (await status()).passkey], ['locked', true])
  const saved = seen.passkey
  seen.passkey = undefined
  assert.deepEqual([(await status()).status, (await status()).passkey], ['locked', false])
  seen.passkey = saved
  const wrong = await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { prf: Buffer.alloc(32, 8).toString('base64url') } })
  assert.equal(wrong.statusCode, 400)
  assert.match(wrong.json().error.message, /Touch ID isn’t set up on this/)
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { prf } })).statusCode, 200)
  assert.equal((await until('on')).email, 'ana@example.com')
})

test('a kit made on another Mac is adopted with its date at sign-out, so Forget leaves words that still restore', async () => {
  const account = keysService.account()
  assert.ok(account)
  const fresh = await kitOf(account)
  const savedAt = Date.parse((seen.kit as { savedAt: string }).savedAt) + 60_000
  seen.kit = { object: 'key_box', kind: 'kit', ...await keysService.signBox({ account, name: 'kit', body: fresh.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  seen.confirmed = { object: 'key_box', kind: 'kit-confirmed', ...await keysService.signBox({ account, name: 'kit-confirmed', body: fresh.box, savedAt }), savedAt: new Date(savedAt).toISOString() }
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })).json().keptAccount, 'ana@example.com')
  assert.deepEqual([keysService.kitState().saved?.box, keysService.kitState().saved?.savedAt], [fresh.box, new Date(savedAt).toISOString()])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 200)
  await signIn('ana@example.com')
  assert.equal((await status()).status, 'locked')
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/unlock', headers, payload: { words: fresh.words } })).statusCode, 200)
  assert.equal((await until('on')).email, 'ana@example.com')
})

test('an account with a workspace box and no kit can start over from Welcome back; once a kit exists it can’t', async () => {
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 200)
  const stale = { id: 'ws_lostmac1', key: 'c3RhbGU', by: 'b', signature: 's' }
  Object.assign(seen, { kit: undefined, members: undefined, workspaces: [stale], lists: [] })
  await signIn('ana@example.com')
  const locked = await status()
  assert.deepEqual([locked.status, locked.kitInCloud], ['locked', false])
  const started = await app.inject({ method: 'DELETE', url: '/api/cloud/key-boxes', headers })
  assert.equal(started.statusCode, 200)
  assert.deepEqual([started.json().email, started.json().kit], ['ana@example.com', null])
  assert.equal((await until('on')).status, 'on')
  assert.notEqual((seen.workspaces[0] as { id: string }).id, stale.id)
  assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/kits', headers })).statusCode, 200)
  await app.inject({ method: 'DELETE', url: '/api/cloud/session', headers })
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/cloud/account', headers })).statusCode, 200)
  await signIn('ana@example.com')
  assert.deepEqual([(await status()).status, (await status()).kitInCloud], ['locked', true])
  const refused = await app.inject({ method: 'DELETE', url: '/api/cloud/key-boxes', headers })
  assert.deepEqual([refused.statusCode, refused.json().error.message], [409, 'Your recovery kit is in OpenHut Cloud now. Type its words to unlock.'])
  assert.ok(seen.kit)
})

test('a Mac taken off the account from another device answers locked with Sign in again, with no session to ask the cloud with', async () => {
  await keysService.setSession(undefined)
  const removed = await status()
  assert.deepEqual([removed.status, removed.needsSignIn, removed.email], ['locked', true, 'ana@example.com'])
})

test('Not me drops the device from home and from each team that lists it, changes no key, and works for a device only a team lists (let in by an admin)', async () => {
  await keysService.forgetHere()
  Object.assign(seen, { kit: undefined, members: undefined, workspaces: [], lists: [] })
  await keysService.open({ sub: 'dev-zed', email: 'zed@example.com' })
  await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const [stolen, approved] = await Promise.all([identity(), identity()])
  const me = await keysService.device()
  const addTo = async ({ ws, device }: { ws?: string; device: string }) => {
    const room = roomKeys.room(ws)
    const body = roomKeys.members(ws)
    assert.ok(room && body)
    const at = Math.max(Date.now(), body.at ?? 0)
    const list = await signList({ signer: me, body: { ...body, version: body.version + 1, previous: await anchorOf(room.list), at, members: body.members.map((member) => member.email === 'zed@example.com' ? { ...member, devices: [...member.devices, device] } : member), added: { ...body.added, [device]: at } } })
    assert.ok(await roomKeys.advance({ lists: [list], ws }))
  }
  const lost = toBase64(stolen.publicKey)
  const asked = toBase64(approved.publicKey)
  await addTo({ device: lost })
  const team = await roomKeys.createTeam()
  const ws = team.workspace.id
  await addTo({ ws, device: lost })
  await addTo({ ws, device: asked })
  const homeKey = keysService.account()?.key
  const listed = await status() as unknown as { devices: { key: string }[] }
  assert.ok(listed.devices.some((each) => each.key === asked), 'Devices shows a device only a team lists')
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(lost)}`, headers })).statusCode, 200)
  assert.equal(roomKeys.members()?.removed.includes(lost), true)
  assert.equal(roomKeys.members(ws)?.removed.includes(lost), true)
  assert.deepEqual([roomKeys.members(ws)?.keyVersion ?? 1, roomKeys.room(ws)?.workspace.version, keysService.account()?.key], [1, 1, homeKey])
  const removed = await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(asked)}`, headers })
  assert.equal(removed.statusCode, 200)
  assert.equal(roomKeys.members(ws)?.members[0]?.devices.includes(asked), false)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/cloud/devices/${encodeURIComponent(asked)}`, headers })).statusCode, 400)
  const changed = await app.inject({ method: 'POST', url: `/api/cloud/workspaces/${encodeURIComponent(ws)}/keys`, headers })
  assert.equal(changed.statusCode, 200)
  assert.deepEqual([roomKeys.members(ws)?.keyVersion, roomKeys.room(ws)?.workspace.version], [2, 2])
})

test('Delete your cloud data is refused while you own a team with other people in it, and nothing leaves', async () => {
  const team = roomKeys.rooms().find((room) => room.workspace.id !== keysService.account()?.workspace.id)
  const body = team && roomKeys.members(team.workspace.id)
  assert.ok(team && body)
  const sara = toBase64((await identity()).publicKey)
  const at = Math.max(Date.now(), body.at ?? 0)
  const list = await signList({ signer: await keysService.device(), body: { ...body, version: body.version + 1, previous: await anchorOf(team.list), at, members: [...body.members, { email: 'sara@example.com', role: 'member', devices: [sara] }], added: { ...body.added, [sara]: at } } })
  assert.ok(await roomKeys.advance({ lists: [list], ws: team.workspace.id }))
  const refused = await app.inject({ method: 'DELETE', url: '/api/cloud', headers })
  assert.equal(refused.statusCode, 409)
  assert.match(refused.json().error.message, /^Make someone else the owner of .+, or delete it first\.$/)
  assert.ok(roomKeys.room(team.workspace.id))
  assert.equal((await status()).status === 'off', false)
})
