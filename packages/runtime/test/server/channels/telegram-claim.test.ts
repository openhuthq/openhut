import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { telegramCodes } from '../../../src/server/channels/telegram-codes.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'

const queue: unknown[] = []
const sent: { chat_id: number; text: string }[] = []
const calls: string[] = []
const telegram = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const reply = (result: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
    if (req.url?.includes('/getMe')) return reply({ username: 'juniper_test_bot' })
    if (req.url?.includes('/sendMessage')) { sent.push(JSON.parse(raw)); return reply({}) }
    if (req.url?.includes('/getUpdates')) calls.push('getUpdates')
    if (req.url?.includes('/getUpdates')) return setTimeout(() => reply(queue.splice(0)), 30)
    res.writeHead(404).end()
  })
}).listen(0, '127.0.0.1')
await new Promise((resolve) => telegram.once('listening', resolve))
Object.assign(config, { telegramApi: `http://127.0.0.1:${(telegram.address() as AddressInfo).port}` })

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_tgowner1', email: 'tg@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values([
  { id: 'ag_tgclaim1', name: 'Juniper', owner_id: 'usr_tgowner1', instructions: '#', model: 'claude:sonnet', net: 74, channel_key: seal('k'.repeat(48)), wanted: 'stopped' },
  { id: 'ag_tgclaim2', name: 'Rover', owner_id: 'usr_tgowner1', instructions: '#', model: 'claude:sonnet', net: 75, channel_key: seal('k'.repeat(48)), wanted: 'stopped' },
  { id: 'ag_tgclaim3', name: 'Moss', owner_id: 'usr_tgowner1', instructions: '#', model: 'claude:sonnet', net: 76, channel_key: seal('k'.repeat(48)), wanted: 'stopped' },
]).execute()
signIn({ email: 'tg@example.com' })
runSet.watch()
await refresh()
const actor = { id: 'usr_tgowner1', email: 'tg@example.com', role: 'owner' as const }
const token = '7381920465:AAHk2QxxxxxxxxxxxxxxxxxxxxxxxxxxXx9Lw'
const message = (id: number, text: string, from: number, name: string) => ({ update_id: id, message: { text, chat: { id: from }, from: { id: from, first_name: name } } })

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read()
    if (ok(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out')
}

let channelId = ''

test('a bot token alone makes a linking channel with a one-time Start link, and the first tap with that code owns it', async () => {
  const made = await channelService.create({ actor, kind: 'telegram', agentId: 'ag_tgclaim1', botToken: token, open: false, allowed: [] })
  channelId = made.id
  assert.equal(made.status, 'linking')
  assert.equal(made.account, '@juniper_test_bot')
  const code = /^https:\/\/t\.me\/juniper_test_bot\?start=([\w-]{22})$/.exec(made.qr ?? '')?.[1] ?? ''
  assert.ok(code, made.qr ?? 'no link')
  assert.equal((await channelService.get({ actor, id: made.id })).qr, made.qr)
  const stranger = { ...actor, email: 'someone@example.com' }
  assert.equal((await channelService.get({ actor: stranger, id: made.id })).qr, null)

  queue.push(message(1, '/start not-the-right-code-at-all', 555551111, 'Eve'), message(2, `/start ${code}`, 123456789, 'Sam'))
  const owned = await until(() => channelService.get({ actor, id: made.id }), (channel) => channel.status === 'connected')
  assert.equal(owned.ownerAddress, '123456789')
  assert.deepEqual(owned.names, { 123456789: 'Sam' })
  assert.deepEqual(sent.map((each) => [each.chat_id, each.text]), [[555551111, 'That link expired or was already used. Open the newest one in OpenHut.'], [123456789, 'Hi Sam, you\'re in. Ask me anything.']])
  assert.deepEqual(await db.selectFrom('telegram_code').select('kind').where('channel_id', '=', made.id).execute(), [], 'no claim code or poller outlives the claim')
})

test('an invite link lets one more person in, once', async () => {
  const invite = await channelService.telegramInvite({ actor, id: channelId })
  const code = /\?start=([\w-]{22})$/.exec(invite.url)?.[1] ?? ''
  assert.ok(code)
  const alex = { userId: '987654321', name: 'Alex', chatId: 987654321 }
  assert.deepEqual(await channelService.telegramJoin({ agentId: 'ag_tgclaim1', code, person: alex }), { object: 'telegram_join', joined: true })
  const channel = await channelService.get({ actor, id: channelId })
  assert.deepEqual(channel.allowed, ['987654321'])
  assert.equal(channel.names?.['987654321'], 'Alex')
  await assert.rejects(channelService.telegramJoin({ agentId: 'ag_tgclaim1', code, person: alex }), /expired or was already used/)
  assert.equal(sent.at(-1)?.text, 'That invite link expired or was already used. Ask for a new one.')
  await assert.rejects(channelService.telegramJoin({ agentId: 'ag_other00', code: 'x'.repeat(22), person: alex }), /expired/)
})

test('codes live in the database, so a restarted runtime shows the same Start link and still honours an invite', async () => {
  const made = await channelService.create({ actor, kind: 'telegram', agentId: 'ag_tgclaim2', botToken: token, open: false, allowed: [] })
  assert.ok(made.qr)
  const stored = await db.selectFrom('telegram_code').selectAll().where('channel_id', '=', made.id).execute()
  assert.deepEqual(stored.map((row) => row.kind), ['claim'])
  assert.ok(stored[0].sealed && !stored[0].sealed.includes(/start=(.+)$/.exec(made.qr ?? '')?.[1] ?? 'x'), 'the claim code is sealed at rest')
  const restarted = await import(`../../../src/server/channels/telegram-codes.ts?restart=${Date.now()}`) as typeof import('../../../src/server/channels/telegram-codes.ts')
  const again = await restarted.telegramCodes.claim({ channelId: made.id, agentId: 'ag_tgclaim2', account: '@juniper_test_bot', botToken: token, onClaim: async () => undefined })
  assert.equal(again, made.qr)
  assert.deepEqual(await restarted.telegramCodes.pending(), [made.id])
  const invite = await channelService.telegramInvite({ actor, id: channelId })
  const code = /\?start=([\w-]{22})$/.exec(invite.url)?.[1] ?? ''
  assert.deepEqual(await restarted.telegramCodes.take({ code, agentId: 'ag_tgclaim1', kind: 'invite' }), { channelId })
  assert.equal(await restarted.telegramCodes.take({ code, agentId: 'ag_tgclaim1', kind: 'invite' }), undefined)
  await restarted.telegramCodes.stop({ channelId: made.id })
  assert.deepEqual(await restarted.telegramCodes.pending(), [])
})

test.after(() => { telegram.close() })
