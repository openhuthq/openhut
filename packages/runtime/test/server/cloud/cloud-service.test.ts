import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, identity, letter, newKey, toBase64 } from '@openhut/common/vault/vault.ts'

const account = { signer: undefined as string | undefined, boxes: new Map<string, { body: string; by: string; signature: string }>(), hideWorkspaces: false, failBoxes: 0, refuseLetters: false, names: [] as string[], sites: [] as (string | undefined)[], refuseName: false }
let authorization = ''
const TEAM = 'ws_teamroom'
const asks = { on: false, device: '', list: undefined as unknown, sent: [] as unknown[] }
const home = { id: '', chain: [] as unknown[], device: '', sent: [] as unknown[], letters: [] as unknown[], deleted: [] as string[] }
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
    asks.sent.push(body)
    return reply(200, {})
  }
  if (asks.on && req.url === `${room}/requests`) return reply(200, { object: 'list', data: asks.device ? [{ device: asks.device }] : [] })
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
    account.sites.push(body.site)
    return account.refuseName ? reply(400, { error: { type: 'invalid_request_error', message: 'Send the name locked.' } }) : reply(200, body)
  }
  if (/^\/v1\/workspaces\/[^/]+\/letters$/.test(req.url ?? '') && req.method === 'GET' && account.refuseLetters) return reply(403, { error: { type: 'permission_error', message: 'Not a member.' } })
  const mine = home.id && `/v1/workspaces/${home.id}`
  if (mine && req.url?.startsWith(`${mine}/member-lists`)) return reply(200, { object: 'list', data: home.chain, hasMore: false })
  if (mine && req.url === `${mine}/requests` && req.method === 'POST') {
    home.sent.push(body)
    return reply(200, {})
  }
  if (mine && req.url === `${mine}/requests`) return reply(200, { object: 'list', data: [{ device: home.device }] })
  if (mine && req.url === `${mine}/letters` && req.method === 'GET') return reply(200, { object: 'list', data: home.letters })
  if (mine && req.url?.startsWith(`${mine}/letters/`) && req.method === 'DELETE') {
    home.deleted.push(decodeURIComponent(req.url.slice(`${mine}/letters/`.length)))
    return reply(200, {})
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
  assert.equal(await roomKeys.openMeta({ ws: made.id, field: 'name', locked: sent }), 'Support')
  account.refuseName = true
  await assert.rejects(cloudService.create({ name: 'Sales' }), (err: Error & { status?: number }) => err.status === 502 && /couldn’t name the workspace\. Try again\./.test(err.message))
  account.refuseName = false
})

test('a team website is sent locked as the bare host on its own, never with the name; a bad one is refused and null clears it', async () => {
  const team = await cloudService.create({ name: 'Website' })
  account.names.length = 0
  await cloudService.update({ workspace: team.id, website: ' https://www.Activepieces.com/about ' })
  const sent = account.sites.at(-1) ?? ''
  assert.deepEqual([account.names, sent.includes('activepieces')], [[''], false])
  assert.equal(await roomKeys.openMeta({ ws: team.id, field: 'site', locked: sent }), 'www.activepieces.com')
  assert.equal(await roomKeys.openMeta({ ws: team.id, field: 'name', locked: sent }), null)
  await assert.rejects(cloudService.update({ workspace: team.id, website: 'localhost:8787' }), (err: Error & { status?: number; param?: string }) => err.status === 400 && err.param === 'website')
  await cloudService.update({ workspace: team.id, website: null })
  assert.equal(await roomKeys.openMeta({ ws: team.id, field: 'site', locked: account.sites.at(-1) }), '')
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

test('asking a team sends only this Mac’s name and OS, shows the admins who can approve, and settles when the request is gone', async () => {
  await keysService.relock({ sub: 'dev-sara', email: 'sara@example.com' })
  await keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  asks.device = await keysService.deviceKey()
  asks.list = await signList({ signer: admin, body: { workspace: TEAM, version: 1, previous: null, members: [{ email: 'ana@example.com', role: 'owner', devices: [toBase64(admin.publicKey)] }, { email: 'sara@example.com', role: 'member', devices: [] }], invites: [], removed: [] } })
  asks.on = true
  const asked = await cloudService.ask()
  assert.equal(asked.canAsk, true)
  assert.deepEqual(asked.asking?.rooms, [{ admins: ['ana@example.com'], own: false }])
  assert.deepEqual(asks.sent.map((each) => Object.keys(each as object).sort()), [['name', 'os']])
  asks.device = ''
  await until(async () => Boolean((await cloudService.status()).asking?.denied))
  await cloudService.cancelAsk()
  asks.on = false
})


test('your own new Mac asks your other computers with no words: a removed Mac is told to sign in again, and an account-key letter sealed to it unlocks and restores it', async () => {
  await keysService.setSession(undefined)
  await keysService.removedHere()
  const first = await keysService.open({ sub: 'dev-sara', email: 'sara@example.com' })
  const firstMac = await keysService.device()
  const box = await keysService.workspaceBox({ account: first })
  account.boxes.clear()
  Object.assign(account, { signer: undefined, hideWorkspaces: false })
  account.boxes.set(`workspace/${box.id}`, { body: box.key, by: box.by, signature: box.signature })
  Object.assign(home, { id: first.workspace.id, chain: [first.list] })
  const session = () => keysService.setSession({ token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })

  await keysService.removedHere()
  await session()
  home.device = await keysService.deviceKey()
  account.refuseLetters = true
  const asked = await cloudService.ask()
  assert.deepEqual(asked.asking?.rooms, [{ admins: ['sara@example.com'], own: true }])
  assert.deepEqual(home.sent.map((each) => Object.keys(each as object).sort()), [['name', 'os']])
  await until(async () => (await cloudService.status()).needsSignIn)
  assert.notEqual(await keysService.deviceKey(), home.device)
  account.refuseLetters = false

  await session()
  await cloudService.ask()
  const newMac = await keysService.device()
  home.device = toBase64(newMac.publicKey)
  const sealed = async (sender: typeof firstMac, id: string) => ({ id, object: 'letter', to: home.device, from: toBase64(sender.publicKey), workspace: home.id, purpose: 'account-key', body: toBase64(await letter({ sender, to: newMac.publicKey, workspace: home.id, purpose: 'account-key', version: 1, plain: fromBase64(first.key) }) ?? new Uint8Array()) })
  home.letters = [await sealed(admin, 'stranger')]
  await sleep(2500)
  assert.equal((await cloudService.status()).status, 'locked', 'a key from a device that isn’t yours opens nothing')
  home.letters = [await sealed(admin, 'stranger'), await sealed(firstMac, 'approved')]
  await until(async () => (await cloudService.status()).status !== 'locked')
  assert.deepEqual([keysService.account()?.key, keysService.account()?.workspace.id], [first.key, first.workspace.id])
  assert.deepEqual(keysService.asked(), [])
  assert.ok(home.deleted.includes('approved'))
  home.id = ''
})
