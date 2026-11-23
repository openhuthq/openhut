import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/cloud/run-set.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { fakeAgentd, signIn } from '../agents/signed-in.ts'

const queue: unknown[] = []
const sent: { chat_id: number; text: string }[] = []
const telegram = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const reply = (result: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
    if (req.url?.includes('/getMe')) return reply({ username: 'juniper_test_bot' })
    if (req.url?.includes('/sendMessage')) { sent.push(JSON.parse(raw)); return reply({}) }
    if (req.url?.includes('/getUpdates')) return setTimeout(() => reply(queue.splice(0)), 30)
    res.writeHead(404).end()
  })
}).listen(0, '127.0.0.1')
await new Promise((resolve) => telegram.once('listening', resolve))
Object.assign(config, { telegramApi: `http://127.0.0.1:${(telegram.address() as AddressInfo).port}` })

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_tgowner1', email: 'tg@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_tgclaim1', name: 'Juniper', owner_id: 'usr_tgowner1', instructions: '#', model: 'claude:sonnet', net: 74, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
signIn({ email: 'tg@example.com' })
runSet.watch()
await runSet.refresh()
const actor = { id: 'usr_tgowner1', email: 'tg@example.com', local: true, role: 'owner' as const }
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
  assert.deepEqual(sent.map((each) => [each.chat_id, each.text]), [[123456789, 'Hi Sam, you\'re in. Ask me anything.']])
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

test.after(() => { telegram.close() })
