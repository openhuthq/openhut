import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import type { MemberList, MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, signList } from '@openhut/common/cloud/member-list.ts'
import { identity, letter, lockInvite, toBase64, type Identity } from '@openhut/common/vault/vault.ts'
import { roomRequest } from './flat.ts'

const room = { invites: new Map<string, { status: number; json: unknown }>(), puts: [] as MemberList[], putStatus: 200, asked: [] as string[] }
const fake = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const flat = roomRequest({ url: req.url, method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {} })
  const url = new URL(flat.url, 'http://room')
  const invite = /\/invites\/([^/]+)$/.exec(url.pathname)?.[1]
  if (invite) room.asked.push(url.search)
  const found = invite ? room.invites.get(invite + (url.searchParams.get('after') === '0' ? '' : url.search)) : undefined
  if (found) return reply(found.status, found.json)
  if (invite) return reply(404, { error: { type: 'invalid_request_error', message: 'gone' } })
  if (flat.method === 'PUT' && flat.url.endsWith('/members')) {
    room.puts.push(flat.body as MemberList)
    return reply(room.putStatus, {})
  }
  reply(404, { error: { type: 'invalid_request_error', message: 'nothing here' } })
}).listen(0, '127.0.0.1')
await once(fake, 'listening')
const fakeAddress = fake.address()
process.env.OPENHUT_CLOUD_URL = `http://127.0.0.1:${typeof fakeAddress === 'object' && fakeAddress ? fakeAddress.port : 0}`
process.env.OPENHUT_API_URL = process.env.OPENHUT_CLOUD_URL
const { invitationController } = await import('../../../src/server/cloud/invite-controller.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { inviteId } = await import('../../../src/server/cloud/room-keys.ts')

await migrate()
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
app.get('/api/agents', async () => ({ object: 'list', data: [] }))
await app.register(invitationController, { prefix: '/api/invitations' })
await app.ready()

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
  assert.equal((await cloudJoin('joins', invite.link)).body.error.message, 'You’re already in this team.')
})

test.after(async () => {
  fake.close()
  await app.close()
})
