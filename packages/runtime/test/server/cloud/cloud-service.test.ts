import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { signProof } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { deviceWords, fromBase64, identity, newKey, toBase64 } from '@openhut/common/vault/vault.ts'

const account = { signer: undefined as string | undefined, boxes: new Map<string, { body: string; by: string; signature: string }>(), hideWorkspaces: false, failBoxes: 0, refuseLetters: false, names: [] as string[], refuseName: false }
let authorization = ''
const TEAM = 'ws_teamroom'
const asks = { on: false, device: '', list: undefined as unknown, commits: [] as string[], nonce: null as { nonce: string; by: string; signature: string } | null, echo: null as string | null, reveals: [] as string[], revealStatus: 500 }
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string> : {}
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const room = `/v1/workspaces/${TEAM}`
  if (asks.on && req.url === '/v1/teams') return reply(200, { object: 'list', data: [{ id: TEAM }] })
  if (asks.on && req.url?.startsWith(`${room}/member-lists`)) return reply(200, { object: 'list', data: [asks.list], hasMore: false })
  if (asks.on && req.url === `${room}/letters`) return reply(200, { object: 'list', data: [] })
  if (asks.on && req.url === `${room}/requests` && req.method === 'POST') {
    asks.commits.push(body.commit ?? '')
    asks.nonce = null
    return reply(200, {})
  }
  if (asks.on && req.url === `${room}/requests`) return reply(200, { object: 'list', data: [{ device: asks.device, nonce: asks.nonce, reveal: asks.echo }] })
  if (asks.on && req.url?.endsWith('/reveal')) {
    asks.reveals.push(body.reveal ?? '')
    return reply(asks.revealStatus, {})
  }
  if (asks.on && req.url?.startsWith(`${room}/requests/`)) return reply(200, {})
  const keep = (name: string, box: { body: string; by: string; signature: string }) => {
    if (account.failBoxes-- > 0) return reply(503, { error: { type: 'api_error', message: 'busy' } })
    if (account.signer && account.signer !== box.by) return reply(403, { error: { type: 'permission_error', message: 'Only your account key can replace your key boxes.' } })
    account.signer ??= box.by
    account.boxes.set(name, box)
    return reply(200, box)
  }
  if (req.url === '/v1/auth/sign-in/social') {
    authorization = body.state ?? ''
    return reply(200, { url: 'https://accounts.example/auth', redirect: false })
  }
  if (req.url === '/v1/auth/openhut/session') return reply(200, { object: 'cloud_session', token: 'session-token', refresh: 'refresh-token', sub: 'dev-sara', email: 'sara@example.com', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
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
  if (/^\/v1\/workspaces\/[^/]+\/members$/.test(req.url ?? '') && req.method === 'PUT') account.signer = (JSON.parse(Buffer.from(body.bytes ?? '', 'base64url').toString()) as { members: { kit?: string }[] }).members[0]?.kit
  if (/^\/v1\/workspaces\/[^/]+$/.test(req.url ?? '') && req.method === 'PATCH') {
    account.names.push(body.name ?? '')
    return account.refuseName ? reply(400, { error: { type: 'invalid_request_error', message: 'Send the name locked.' } }) : reply(200, body)
  }
  if (/^\/v1\/workspaces\/[^/]+\/letters$/.test(req.url ?? '') && req.method === 'GET' && account.refuseLetters) return reply(403, { error: { type: 'permission_error', message: 'Not a member.' } })
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

test('a Change keys whose first move fails once is kept and finished later: Make a new kit then works and the old boxes are gone', async () => {
  await keysService.setLocked(undefined)
  Object.assign(account, { signer: undefined, hideWorkspaces: false })
  account.boxes.clear()
  const first = await keysService.open({ sub: 'dev-sara', email: 'sara@example.com' })
  await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const kitOf = async () => toBase64((await accountDevice(fromBase64(keysService.account()?.key ?? ''))).publicKey)
  const oldKit = await kitOf()
  const box = await keysService.workspaceBox({ account: first })
  account.boxes.set(`workspace/${box.id}`, { body: box.key, by: box.by, signature: box.signature })
  await cloudService.newKit()
  account.boxes.set('passkey', { body: 'old-passkey', by: oldKit, signature: 'signed' })
  assert.equal(account.signer, oldKit)
  await addStolen()
  account.failBoxes = 1
  await assert.rejects(cloudService.changeKeys({ workspace: first.workspace.id }), (err: Error & { status?: number }) => err.status === 502 && /tries again/.test(err.message))
  const newKit = await kitOf()
  assert.equal(account.signer, newKit, 'the signer is the kit on the new list, with no handover')
  assert.deepEqual(keysService.moves().map((move) => `${move.method} ${move.path}`), ['POST /v1/workspaces', 'DELETE /v1/key-boxes/kit', 'DELETE /v1/key-boxes/kit-confirmed', 'DELETE /v1/key-boxes/passkey'])
  const kit = await cloudService.newKit()
  assert.equal(kit.words.length, 12)
  assert.notEqual(newKit, oldKit)
  assert.deepEqual(keysService.moves(), [])
  assert.deepEqual([...account.boxes].map(([name, each]) => [name, each.by]).sort(), [['kit', newKit], ['kit-confirmed', newKit], [`workspace/${box.id}`, newKit]])
})

test('a stored move another Mac’s rotation made stale is refused and dropped, so it doesn’t block Change keys', async () => {
  const account0 = keysService.account()
  assert.ok(account0)
  const stale = await keysService.signBox({ account: { ...account0, key: toBase64(newKey()) }, name: 'delete/kit', body: '' })
  await keysService.setMoves([{ method: 'DELETE', path: '/v1/key-boxes/kit', body: stale }])
  await cloudService.changeKeys({ workspace: account0.workspace.id })
  assert.deepEqual(keysService.moves(), [])
  assert.equal(account.signer, toBase64((await accountDevice(fromBase64(keysService.account()?.key ?? ''))).publicKey))
})

test('a new workspace sends its name locked, and a name the cloud refuses is an error, not a workspace with the default name', async () => {
  const made = await cloudService.create({ name: 'Support' })
  const sent = account.names.at(-1) ?? ''
  assert.notEqual(sent, 'Support')
  assert.equal(sent.includes('Support'), false)
  assert.equal(await roomKeys.openName({ ws: made.id, locked: sent }), 'Support')
  account.refuseName = true
  await assert.rejects(cloudService.create({ name: 'Sales' }), (err: Error & { status?: number }) => err.status === 502 && /couldn’t name the workspace\. Try again\./.test(err.message))
  account.refuseName = false
})

test('a locked Mac whose device key was removed stops pairing at once, gets a new device key, and asks to sign in again', async () => {
  const before = await keysService.deviceKey()
  await keysService.relock({ sub: 'dev-sara', email: 'sara@example.com' })
  account.refuseLetters = true
  await assert.rejects(cloudService.startPairing(), (err: Error & { status?: number }) => err.status === 403 && /removed from your account\. Sign in again/.test(err.message))
  const after = await cloudService.status()
  assert.deepEqual([after.status, after.needsSignIn, after.email], ['locked', true, 'sara@example.com'])
  assert.notEqual(after.device, before)
  account.refuseLetters = false
})

let stolen = ''
async function addStolen(): Promise<void> {
  const current = keysService.account()
  const body = roomKeys.members()
  assert.ok(current && body)
  stolen = toBase64((await identity()).publicKey)
  const at = Date.now()
  const mine = body.members[0]
  await roomKeys.advance({ lists: [await signList({ signer: await keysService.device(), body: { ...body, version: body.version + 1, previous: await anchorOf(current.list), at, members: [{ ...mine, devices: [...mine.devices, stolen] }], added: { ...body.added, [stolen]: at } } })] })
}

async function until(done: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 40 && !await done(); tries++) await sleep(250)
  assert.ok(await done(), 'timed out waiting')
}

const admin = await identity()
async function signedNonce(): Promise<{ nonce: string; by: string; signature: string }> {
  const nonce = toBase64(newKey(16))
  return { nonce, by: toBase64(admin.publicKey), signature: await signProof({ signer: admin, proof: 'words', parts: [TEAM, asks.device, asks.commits.at(-1) ?? '', nonce] }) }
}

async function wordsOf({ nonce, reveal }: { nonce: string; reveal: string }): Promise<string[]> {
  return deviceWords({ device: fromBase64(asks.device), nonce: fromBase64(nonce), reveal: fromBase64(reveal) })
}

test('a cloud that fails the reveal, learns r and swaps in another nonce gets no words from it: the Mac asks again with a new r and says why', async () => {
  await keysService.relock({ sub: 'dev-sara', email: 'sara@example.com' })
  await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  asks.device = await keysService.deviceKey()
  asks.list = await signList({ signer: admin, body: { workspace: TEAM, version: 1, previous: null, members: [{ email: 'ana@example.com', role: 'owner', devices: [toBase64(admin.publicKey)] }, { email: 'sara@example.com', role: 'member', devices: [] }], invites: [], removed: [] } })
  asks.on = true
  await cloudService.ask()
  asks.nonce = { ...await signedNonce(), signature: toBase64(newKey(64)) }
  await sleep(2500)
  assert.deepEqual(asks.reveals, [], 'r never leaves the Mac for a nonce no admin signed')
  const first = await signedNonce()
  asks.nonce = first
  await until(() => asks.reveals.length > 0)
  const r = asks.reveals[0] ?? ''
  assert.deepEqual(keysService.asked()[0]?.words, await wordsOf({ nonce: first.nonce, reveal: r }), 'the words are fixed from the first nonce before r leaves')
  const swapped = await signedNonce()
  Object.assign(asks, { nonce: swapped, echo: r, revealStatus: 200 })
  const ground = await wordsOf({ nonce: swapped.nonce, reveal: r })
  await until(() => asks.commits.length === 2)
  await until(async () => /asked again with new words/.test((await cloudService.status()).asking?.error ?? ''))
  const after = await cloudService.status()
  assert.deepEqual(after.asking?.rooms.map((each) => each.words), [null])
  assert.notEqual(keysService.asked()[0]?.secret, r)
  assert.equal(keysService.asked()[0]?.nonce, undefined)
  assert.ok(asks.reveals.every((each) => each === r), 'r is only ever revealed for the first nonce')
  const fresh = await signedNonce()
  asks.nonce = fresh
  await until(async () => Boolean((await cloudService.status()).asking?.rooms[0]?.words))
  const words = (await cloudService.status()).asking?.rooms[0]?.words
  assert.deepEqual(words, await wordsOf({ nonce: fresh.nonce, reveal: asks.reveals.at(-1) ?? '' }))
  assert.notDeepEqual(words, ground)
})

test('a restart between the nonce and the reveal keeps the same words', async () => {
  await cloudService.ask()
  Object.assign(asks, { echo: null, revealStatus: 500, reveals: [] })
  const nonce = await signedNonce()
  asks.nonce = nonce
  await until(() => asks.reveals.length > 0)
  const before = keysService.asked()[0]?.words
  assert.deepEqual(before, await wordsOf({ nonce: nonce.nonce, reveal: asks.reveals[0] ?? '' }))
  const fresh = '../../../src/server/cloud/cloud-service.ts?restart'
  const restarted = (await import(fresh) as typeof import('../../../src/server/cloud/cloud-service.ts')).cloudService
  asks.revealStatus = 200
  await until(async () => Boolean((await restarted.status()).asking?.rooms[0]?.words))
  assert.deepEqual((await restarted.status()).asking?.rooms[0]?.words, before)
  assert.equal(asks.commits.length, 3, 'the restart doesn’t start a new ask')
  await restarted.cancelAsk()
  await cloudService.cancelAsk()
  asks.on = false
})
