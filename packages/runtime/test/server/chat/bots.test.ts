import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPlugins } from '../../../src/core/plugins.ts'
import { bots } from '../../../src/server/chat/bots.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { emit } from '../../../src/server/platform/events.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { refresh } from '../agents/signed-in.ts'
import * as discord from './fake-discord.ts'

config.discordApi = await discord.listen()
await migrate()
await db.insertInto('person').values({ id: 'usr_botownr', email: 'bot@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_botpolice', name: 'Database Police', owner_id: 'usr_botownr', instructions: '#', model: 'sonnet', net: 51, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
await db.insertInto('channel').values({ id: 'ch_botdisco', agent_id: 'ag_botpolice', kind: 'discord', status: 'connected', account: '@pulse', owner_address: '', open: false, allowed: discord.CHANNEL, secrets: seal(JSON.stringify({ botToken: discord.TOKEN })) }).execute()
await refresh()
test.after(() => discord.close())

const until = async (what: string, ok: () => boolean | Promise<boolean>) => {
  for (const end = Date.now() + 15_000; !(await ok());) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
const row = async () => (await channelService.list({ agentId: 'ag_botpolice' })).find((each) => each.kind === 'discord')
const changed = () => emit({ name: 'agent.applied', target: { type: 'agent', id: 'ag_botpolice' } })

test('the boot that app.ts runs connects each running agent\'s Discord bot to the gateway, and the channel says Connected only once it is', async () => {
  assert.equal(discord.connected(), 0)
  startPlugins()
  await until('the bot on the gateway', () => discord.identified.includes(discord.TOKEN))
  await until('the bot ready', async () => !bots.offline('ag_botpolice'))
  assert.equal((await row())?.offline, undefined)
})

test('a new token restarts only that bot; one Discord refuses shows on the channel instead of Connected', async () => {
  await db.updateTable('channel').set({ secrets: seal(JSON.stringify({ botToken: discord.BAD_TOKEN })) }).where('id', '=', 'ch_botdisco').execute()
  changed()
  await until('the refusal', async () => (await row())?.offline === 'Discord didn\'t accept the bot token. Connect Discord again with a new token.')
  await db.updateTable('channel').set({ secrets: seal(JSON.stringify({ botToken: discord.TOKEN })) }).where('id', '=', 'ch_botdisco').execute()
  changed()
  await until('the bot back', async () => discord.connected() === 1 && !bots.offline('ag_botpolice'))
})

test('stopping the agent or removing Discord closes its bot; starting it again reconnects', async () => {
  await db.updateTable('agent').set({ wanted: 'stopped' }).where('id', '=', 'ag_botpolice').execute()
  changed()
  await until('the bot gone', () => discord.connected() === 0)
  assert.equal(bots.offline('ag_botpolice'), undefined)
  await db.updateTable('agent').set({ wanted: 'running' }).where('id', '=', 'ag_botpolice').execute()
  changed()
  await until('the bot back', () => discord.connected() === 1)
  await db.deleteFrom('channel').where('id', '=', 'ch_botdisco').execute()
  emit({ name: 'channel.deleted', target: { type: 'channel', id: 'ch_botdisco' } })
  await until('the bot gone', () => discord.connected() === 0)
})
