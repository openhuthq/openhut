import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { checkProof, type MemberList, type MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { fromBase64, identity, newKey, read, toBase64 } from '@openhut/common/vault/vault.ts'
import type { Box, Letter } from '../../../src/server/platform/cloud.ts'
import { roomRequest } from './flat.ts'

const serverSecret = newKey()
const server = await identity(serverSecret)
const serverKey = toBase64(server.publicKey)
const room = { lists: [] as MemberList[], boxes: [] as unknown[], letters: [] as (Letter & { id: string; from: string })[], deleted: [] as string[], asked: [] as Record<string, unknown>[], waiting: [] as unknown[], bundles: [] as { letters: Letter[]; boxes: Box[] }[], joined: [] as string[] }
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const { url, method, body, letters, boxes } = roomRequest({ url: req.url, method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {} })
  const reply = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  const versionOf = (list: MemberList) => (JSON.parse(Buffer.from(list.bytes, 'base64url').toString()) as MemberListBody).version
  if (url === '/v1/sessions/join') {
    const signed = body.device === serverKey && await checkProof({ device: serverKey, proof: 'session', parts: [String(body.join)], signature: String(body.signature) })
    room.joined.push(String(body.join))
    return reply(signed ? 200 : 400, { object: 'cloud_session', token: 'server-token', refresh: 'server-refresh', sub: 'dev-mo', email: 'mo@example.com', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  }
  if (url.endsWith('/members') && method === 'PUT') {
    const list = body as unknown as MemberList
    room.lists.push(list)
    room.bundles.push({ letters, boxes })
    room.letters.push(...letters.map((each, index) => ({ ...each, id: `letter_${room.letters.length + index}`, object: 'letter' as const, from: list.by, workspace: url.split('/')[3] ?? '' })))
    return reply(200, list)
  }
  if (url === '/v1/workspaces') return reply(200, { object: 'list', data: room.boxes })
  if (url === '/v1/teams') return reply(200, { object: 'list', data: [] })
  if (url.includes('/member-lists')) return reply(200, { object: 'list', data: room.lists.filter((list) => versionOf(list) > Number(new URL(url, 'http://cloud').searchParams.get('after') ?? 0)), hasMore: false })
  if (url.endsWith('/requests') && method === 'POST') return reply(200, room.asked[room.asked.length] = body)
  if (url.endsWith('/requests')) return reply(200, { object: 'list', data: room.waiting })
  if (url.endsWith('/letters') && method === 'GET') return reply(200, { object: 'list', data: room.letters.filter((each) => !room.deleted.includes(each.id)) })
  if (url.includes('/letters/') && method === 'DELETE') return reply(200, { deleted: room.deleted.push(url.split('/').pop() ?? '') })
  reply(404, { error: { type: 'invalid_request_error', message: 'none' } })
})
cloud.listen(0, '127.0.0.1')
await once(cloud, 'listening')
const address = cloud.address()
process.env.OPENHUT_API_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

const { migrate } = await import('../../../src/server/platform/db.ts')
await migrate()
const { config } = await import('../../../src/server/platform/config.ts')
const { keyStore } = await import('../../../src/server/cloud/key-store.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { roomKeys } = await import('../../../src/server/cloud/room-keys.ts')
const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
const { cloudService } = await import('../../../src/server/cloud/cloud-service.ts')
after(() => {
  cloudEvents.stop()
  cloud.close()
})

test('a Mac approves a server with one bundle that lists it as a runtime and seals it the workspace key, own and vault; the server, started with OPENHUT_JOIN, takes them', async () => {
  const mac = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  await keysService.setSession({ token: 'mac-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const home = mac.workspace.id
  const own = await roomKeys.own(home)
  const { id, key, by, signature } = await keysService.workspaceBox({ account: mac })
  room.boxes.push({ id, key, by, signature })
  room.lists.push(mac.list)
  room.waiting.push({ device: serverKey, email: 'mo@example.com', at: new Date().toISOString(), name: 'hetzner-1', os: 'Linux', server: true })
  await cloudEvents.refreshRequests(home)
  await cloudService.approve({ workspace: home, device: serverKey })

  const [bundle] = room.bundles
  assert.ok(bundle && room.bundles.length === 1)
  const listed = JSON.parse(Buffer.from(room.lists.at(-1)?.bytes ?? '', 'base64url').toString()) as MemberListBody
  assert.deepEqual([listed.runtimes, listed.members[0]?.devices.includes(serverKey), listed.names?.[serverKey]], [[serverKey], true, 'hetzner-1'])
  assert.deepEqual(bundle.letters.map((each) => [each.to, each.purpose]), [[serverKey, 'workspace-key']])
  const plain = await read({ recipient: server, from: fromBase64(await keysService.deviceKey()), workspace: home, purpose: 'workspace-key', body: fromBase64(bundle.letters[0]?.body ?? ''), allowed: [fromBase64(await keysService.deviceKey())] })
  const sealed = JSON.parse(new TextDecoder().decode(plain ?? new Uint8Array())) as { key: string; own?: string; vault?: string }
  assert.deepEqual([sealed.key, sealed.own, sealed.vault], [mac.workspace.key, own && toBase64(own), mac.vault])

  await keyStore.write({ device: toBase64(serverSecret), machine: keyStore.machine })
  config.join = 'join-code-1'
  cloudService.connect()
  for (let i = 0; i < 200 && !keysService.account(); i++) await sleep(25)
  const joined = keysService.account()
  assert.deepEqual(room.joined, ['join-code-1'])
  assert.equal(room.asked[0]?.server, true)
  assert.deepEqual([joined?.email, joined?.workspace.id, joined?.workspace.key, joined?.workspace.own, joined?.vault, joined?.key], ['mo@example.com', home, mac.workspace.key, own && toBase64(own), mac.vault, ''])
  assert.equal(await keysService.deviceKey(), serverKey)
  assert.equal(keysService.locked(), undefined)
  assert.equal(roomKeys.isOwn(home), true)
  assert.deepEqual(room.deleted, ['letter_0'])
  assert.equal(keysService.session()?.refresh, 'server-refresh')
})
