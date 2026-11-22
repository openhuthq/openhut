import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import type { MemberList, MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, signList } from '@openhut/common/cloud/member-list.ts'
import { identity, letter, lockInvite, toBase64, type Identity } from '@openhut/common/vault/vault.ts'
import { connect, generateKeyPair, toHex, type Tunnel, type TunnelError } from '@openhut/tunnel'
import { startRelay, waitFor } from '@openhut/tunnel/test/relay.ts'
import { canonical, type Access, type Unsigned } from '@openhut/common/access/access.ts'
import type { Invitation } from '@openhut/common/access/invitation.ts'

const relay = await startRelay()
const room = { invites: new Map<string, { status: number; json: unknown }>(), puts: [] as MemberList[], putStatus: 200, asked: [] as string[] }
const fake = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const url = new URL(req.url ?? '', 'http://room')
  const invite = /\/invites\/([^/]+)$/.exec(url.pathname)?.[1]
  if (invite) room.asked.push(url.search)
  const found = invite ? room.invites.get(invite + (url.searchParams.get('after') === '0' ? '' : url.search)) : undefined
  if (found) return reply(found.status, found.json)
  if (invite) return reply(404, { error: { type: 'invalid_request_error', message: 'gone' } })
  if (req.method === 'PUT' && req.url?.endsWith('/members')) {
    room.puts.push(JSON.parse(Buffer.concat(chunks).toString()) as MemberList)
    return reply(room.putStatus, {})
  }
  reply(404, { error: { type: 'invalid_request_error', message: 'nothing here' } })
}).listen(0, '127.0.0.1')
await once(fake, 'listening')
const fakeAddress = fake.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof fakeAddress === 'object' && fakeAddress ? fakeAddress.port : 0}`
const { config } = await import('../../../src/server/platform/config.ts')
config.relayUrl = relay.url
const { accessService } = await import('../../../src/server/access/access-service.ts')
const { invitationController } = await import('../../../src/server/access/invitation-controller.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { inviteId } = await import('../../../src/server/cloud/room-keys.ts')
const { computerId, relayKeyHex } = await import('../../../src/server/platform/secrets.ts')
const { relayService } = await import('../../../src/server/relay/relay-service.ts')

await migrate()
const owner = generateKeyPairSync('ed25519')
const ownerKey = Buffer.from(owner.publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex')
const MAC = randomBytes(32).toString('hex')
const computer = { id: computerId, key: relayKeyHex }
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
app.get('/api/agents', async () => ({ object: 'list', data: [] }))
await app.register(invitationController, { prefix: '/api/invitations' })
await app.ready()
let version = 0

function signed(clients: string[]): Access {
  const unsigned: Unsigned = { object: 'access', owner: ownerKey, version: ++version, clients: [MAC, ...clients].map((key) => ({ key, name: 'Device', addedAt: '2026-11-18T09:00:00.000Z' })), computers: [] }
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') }
}

const ask = async ({ method = 'GET', url }: { method?: 'GET' | 'POST' | 'DELETE'; url: string }) => {
  const response = await app.inject({ method, url, headers: { authorization: 'Bearer test-key' } })
  return { status: response.statusCode, body: response.json() }
}
const invite = async (): Promise<Invitation & { secret: string }> => {
  const { body } = await ask({ method: 'POST', url: '/api/invitations' })
  return { ...body, secret: new URL(body.code).searchParams.get('s') }
}
const look = async (id: string): Promise<Invitation> => (await ask({ url: `/api/invitations/${id}` })).body
const join = (secret: string, key = generateKeyPair()) => connect({ relayUrl: relay.url, computer, key, invitation: { secret, name: 'Mo\'s iPhone', kind: 'client' } })
const messages = async (tunnel: Tunnel) => {
  const seen = []
  for await (const message of tunnel.control) seen.push(message)
  return seen
}

test('with no list yet there is no owner to put in a code, so no invitation', async () => {
  const { status, body } = await ask({ method: 'POST', url: '/api/invitations' })
  assert.equal(status, 404)
  assert.match(body.error.message, /no access list yet/)
  await accessService.put({ access: signed([]), local: true })
  await relayService.start({ server: app.server })
  assert.equal(relayService.state().relay, false)
  await invite()
  assert.equal(relayService.state().relay, true)
  await waitFor(relay.online)
})

test('a code carries this computer, its Noise key, the list\'s owner, a secret and the relay', async () => {
  const invitation = await invite()
  const code = new URL(invitation.code ?? '')
  assert.equal(`${code.protocol}//${code.host}`, 'openhut://join')
  assert.deepEqual(Object.fromEntries(code.searchParams), { c: computerId, k: relayKeyHex, o: ownerKey, s: invitation.secret, r: relay.url })
  assert.match(invitation.secret, /^[0-9a-f]{64}$/)
  assert.equal(invitation.status, 'waiting')
  assert.equal(Date.parse(invitation.expiresAt) - Date.now() > 4 * 60_000, true)
  assert.equal((await look(invitation.id)).code, undefined)
})

test('a wrong secret gets no device and leaves the invitation waiting', async () => {
  const invitation = await invite()
  assert.deepEqual(await messages(await join(randomBytes(32).toString('hex'))), [])
  assert.deepEqual(await look(invitation.id), { object: 'invitation', id: invitation.id, status: 'waiting', expiresAt: invitation.expiresAt, device: null, digits: null })
})

test('a joined device shows the same digits on both sides, can\'t reach a route before it\'s accepted, and the invitation can\'t be used twice', async () => {
  const invitation = await invite()
  const key = generateKeyPair()
  const tunnel = await join(invitation.secret, key)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  assert.deepEqual(await look(invitation.id), { object: 'invitation', id: invitation.id, status: 'joined', expiresAt: invitation.expiresAt, device: { name: 'Mo\'s iPhone', kind: 'client', key: toHex(key.publicKey) }, digits: tunnel.digits })
  assert.deepEqual(await messages(await join(invitation.secret)), [])
  assert.equal((await look(invitation.id)).device?.key, toHex(key.publicKey))
  await assert.rejects(tunnel.fetch('/api/agents'), (error: TunnelError) => error.type === 'removed')
})

test('the owner declining tells the device and ends the session', async () => {
  const invitation = await invite()
  const tunnel = await join(invitation.secret)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  assert.equal((await ask({ method: 'DELETE', url: `/api/invitations/${invitation.id}` })).body.status, 'declined')
  assert.deepEqual(await messages(tunnel), [{ type: 'declined' }])
})

test('an expired invitation lets nobody join, and one that runs out while joined is declined', async () => {
  const late = await invite()
  const pending = await invite()
  const waiting = await join(pending.secret)
  await waitFor(async () => (await look(pending.id)).status === 'joined')
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 5 * 60_000 + 1000 })
  try {
    assert.equal((await look(late.id)).status, 'expired')
    assert.deepEqual(await messages(await join(late.secret)), [])
    assert.equal((await look(late.id)).device, null)
    assert.deepEqual(await messages(waiting), [{ type: 'declined' }])
    assert.equal((await look(pending.id)).status, 'expired')
  } finally {
    mock.timers.reset()
  }
})

test('the device is accepted as soon as the list holds its key, with that list, and then reaches routes', async () => {
  const invitation = await invite()
  const key = generateKeyPair()
  const tunnel = await join(invitation.secret, key)
  await waitFor(async () => (await look(invitation.id)).status === 'joined')
  const list = signed([toHex(key.publicKey)])
  await accessService.put({ access: list, local: true })
  const control = tunnel.control[Symbol.asyncIterator]()
  assert.deepEqual((await control.next()).value, { type: 'accepted', access: list })
  assert.equal((await look(invitation.id)).status, 'accepted')
  assert.equal((await tunnel.fetch('/api/agents')).status, 200)
  assert.equal((await ask({ method: 'DELETE', url: `/api/invitations/${invitation.id}` })).status, 409)
  tunnel.close()
})

const WS = 'TeamWorkspace01'

async function teamInvite({ email = 'ana@example.com', mo, card }: { email?: string; mo?: Identity; card?: Identity } = {}) {
  mo ??= await identity()
  card ??= await identity()
  const at = Date.now()
  const genesis: MemberListBody = { workspace: WS, version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices: [toBase64(mo.publicKey)] }], invites: [], removed: [], at, added: { [toBase64(mo.publicKey)]: at } }
  const first = await signList({ signer: mo, body: genesis })
  const second = await signList({ signer: mo, body: { ...genesis, version: 2, previous: await anchorOf(first), invites: [{ email, role: 'member', key: toBase64(card.publicKey) }] } })
  const plain = await lockInvite({ secret: card.secret, workspace: WS, plain: new TextEncoder().encode(JSON.stringify({ workspace: WS, name: 'Activepieces', from: 'mo@example.com', email, role: 'member', anchor: await anchorOf(first), expiresAt: new Date(at + 48 * 3600_000).toISOString() })) })
  assert.ok(plain)
  const body = toBase64(await letter({ sender: mo, to: card.publicKey, workspace: WS, purpose: 'invite', version: 1, plain }) ?? new Uint8Array())
  const id = await inviteId(card.publicKey)
  room.invites.set(id, { status: 200, json: { id, object: 'invite', workspace: WS, email, role: 'member', key: toBase64(card.publicKey), from: toBase64(mo.publicKey), body, expiresAt: new Date(at + 48 * 3600_000).toISOString(), memberLists: [first, second] } })
  return { id, first, second, mo, card, link: `https://openhut.dev/join#${WS}.${toBase64(card.secret)}` }
}

const cloudJoin = async (path: 'previews' | 'joins', link: string) => {
  const response = await app.inject({ method: 'POST', url: `/api/invitations/cloud/${path}`, headers: { authorization: 'Bearer test-key' }, payload: { link } })
  return { status: response.statusCode, body: response.json() }
}

test('a used, expired or wrong-email cloud invite is refused with a sentence', async () => {
  await keysService.open({ sub: 'dev-ana', email: 'ana@example.com' })
  await keysService.setSession({ token: 'session', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
  assert.deepEqual(await cloudJoin('previews', 'https://openhut.dev/join#nope'), { status: 400, body: { error: { type: 'invalid_request_error', message: 'That isn’t an OpenHut invite link. Copy the whole link and try again.', param: 'link' } } })
  const used = await teamInvite()
  room.invites.delete(used.id)
  const gone = await cloudJoin('previews', used.link)
  assert.deepEqual([gone.status, gone.body.error.message], [404, 'This invite link no longer works. It was used already, or it was taken back. Ask for a new one.'])
  const late = await teamInvite()
  room.invites.set(late.id, { status: 410, json: { error: { type: 'invalid_request_error', message: 'This invite link expired. Invites last 48 hours.' } } })
  const expired = await cloudJoin('joins', late.link)
  assert.deepEqual([expired.status, expired.body.error.message], [410, 'This invite link expired. Invites last 48 hours. Ask for a new one.'])
  const other = await teamInvite({ email: 'ana.k@example.com' })
  room.invites.set(other.id, { status: 403, json: { error: { type: 'permission_error', message: 'This invite is for ana.k@example.com. You’re signed in as ana@example.com.' } } })
  const wrong = await cloudJoin('joins', other.link)
  assert.deepEqual([wrong.status, wrong.body.error.message, wrong.body.error.param], [403, 'This invite is for ana.k@example.com. You’re signed in as ana@example.com.', 'ana.k@example.com'])
  assert.equal(room.puts.length, 0)
})

test('a cloud that swaps in its own workspace behind a real link, knowing only the card’s public key, is refused', async () => {
  const real = await teamInvite()
  const evil = await identity()
  const fakeCard = await identity()
  const forged = await teamInvite({ mo: evil, card: fakeCard })
  const sealedToReal = await letter({ sender: evil, to: real.card.publicKey, workspace: WS, purpose: 'invite', version: 1, plain: new TextEncoder().encode(JSON.stringify({ workspace: WS, name: 'Mo’s workspace', from: 'mo@example.com', email: 'ana@example.com', role: 'member', anchor: await anchorOf(forged.first), expiresAt: new Date(Date.now() + 3600_000).toISOString() })) })
  const forgedJson = room.invites.get(forged.id)?.json as { [name: string]: unknown }
  room.invites.set(real.id, { status: 200, json: { ...forgedJson, id: real.id, key: toBase64(real.card.publicKey), from: toBase64(evil.publicKey), body: toBase64(sealedToReal ?? new Uint8Array()) } })
  const puts = room.puts.length
  const preview = await cloudJoin('previews', real.link)
  assert.deepEqual([preview.status, preview.body.error.message], [400, 'This invite doesn’t check out. Ask for a new link.'])
  assert.equal((await cloudJoin('joins', real.link)).status, 400)
  assert.equal(room.puts.length, puts)
})

test('a member list longer than one page comes in pages, so the join signs the latest version', async () => {
  const invite = await teamInvite()
  const json = room.invites.get(invite.id)?.json as { [name: string]: unknown }
  room.invites.set(invite.id, { status: 200, json: { ...json, memberLists: [invite.first], hasMore: true } })
  room.invites.set(`${invite.id}?after=1`, { status: 200, json: { ...json, memberLists: [invite.second], hasMore: false } })
  const puts = room.puts.length
  room.putStatus = 409
  await cloudJoin('joins', invite.link)
  room.putStatus = 200
  const put = room.puts.at(-1)
  assert.equal(room.puts.length, puts + 1)
  assert.ok(put && await check({ anchor: await anchorOf(invite.first), chain: [invite.first, invite.second, put] }))
})

test('losing a join race reads as a used link, not a server error', async () => {
  const invite = await teamInvite()
  room.putStatus = 409
  const lost = await cloudJoin('joins', invite.link)
  room.putStatus = 200
  assert.deepEqual([lost.status, lost.body.error.message], [404, 'This invite link no longer works. It was used already, or it was taken back. Ask for a new one.'])
})

test('joining reads the sealed invite, signs the join with the link’s key and waits for an admin to send the workspace key', async () => {
  const invite = await teamInvite()
  const preview = await cloudJoin('previews', invite.link)
  assert.deepEqual(preview.body, { object: 'cloud_invite_preview', workspace: WS, name: 'Activepieces', from: 'mo@example.com', email: 'ana@example.com', role: 'member' })
  const joined = await cloudJoin('joins', invite.link)
  assert.equal(joined.status, 200)
  const put = room.puts.at(-1)
  assert.ok(put)
  const body = await check({ anchor: await anchorOf(invite.first), chain: [invite.first, invite.second, put] })
  assert.deepEqual(body?.members.map((member) => [member.email, member.role, member.devices]), [['mo@example.com', 'owner', body?.members[0]?.devices], ['ana@example.com', 'member', [await keysService.deviceKey()]]])
  assert.deepEqual(body?.invites, [])
  assert.deepEqual(joined.body.workspaces.map((each: { id: string; home: boolean; waiting: boolean; role: string }) => [each.home, each.waiting, each.role]), [[true, false, 'owner'], [false, true, 'member']])
  assert.equal((await cloudJoin('joins', invite.link)).body.error.message, 'You’re already in this workspace.')
})

test.after(async () => {
  fake.close()
  relayService.stop()
  await app.close()
  await relay.close()
})
