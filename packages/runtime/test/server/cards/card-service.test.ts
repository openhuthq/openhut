import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { cardService } from '../../../src/server/cards/card-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_cardownr', email: 'cards@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values([
  { id: 'ag_cardslak', name: 'Slacker', owner_id: 'usr_cardownr', instructions: '#', model: 'sonnet', net: 31, channel_key: seal('k'.repeat(32)) },
  { id: 'ag_cardnone', name: 'Plain', owner_id: 'usr_cardownr', instructions: '#', model: 'sonnet', net: 32, channel_key: seal('k'.repeat(32)) },
]).execute()
await db.insertInto('channel').values({ id: 'ch_cardslak', agent_id: 'ag_cardslak', kind: 'slack', status: 'connected', account: 'Acme', owner_address: '', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: 'xoxb-card', appToken: 'xapp-card' })) }).execute()

const slacker = { id: 'ag_cardslak', owner_id: 'usr_cardownr', net: 31 }
const plain = { id: 'ag_cardnone', owner_id: 'usr_cardownr', net: 32 }
const CARD = [
  '{"op":"add","path":"/root","value":"c"}',
  '{"op":"add","path":"/elements/c","value":{"type":"Card","props":{"title":"Deploy #142"},"children":["f","t","acts"]}}',
  '{"op":"add","path":"/elements/f","value":{"type":"Fields","props":{},"children":["f1"]}}',
  '{"op":"add","path":"/elements/f1","value":{"type":"Field","props":{"label":"Tests","value":"312 passed"}}}',
  '{"op":"add","path":"/elements/t","value":{"type":"Table","props":{"headers":["env","p95"],"rows":[["prod","210"]]}}}',
  '{"op":"add","path":"/elements/acts","value":{"type":"Actions","props":{},"children":["ok","logs"]}}',
  '{"op":"add","path":"/elements/ok","value":{"type":"Button","props":{"id":"approve","label":"Approve","style":"primary"}}}',
  '{"op":"add","path":"/elements/logs","value":{"type":"LinkButton","props":{"label":"Logs","url":"https://ci.example.com/142"}}}',
].join('\n')
const reply = `Ready to ship.\n\n\`\`\`spec\n${CARD}\n\`\`\`\n\nSay the word.`

function fakeSlack(t: TestContext, ok = true) {
  const posted: URLSearchParams[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    posted.push(new URLSearchParams(String(init?.body)))
    return Response.json(ok ? { ok: true } : { ok: false, error: 'not_in_channel' })
  })
  return posted
}

test('a reply without a card passes through untouched', async () => {
  assert.deepEqual(await cardService.render({ agent: plain, text: 'Just words.', channel: 'telegram' }), { text: 'Just words.' })
})

test('on Slack the card goes out as Block Kit in the thread, and the reply keeps only its words', async (t) => {
  const posted = fakeSlack(t)
  const { text } = await cardService.render({ agent: slacker, text: reply, channel: 'slack', chatId: 'C0OPS', threadId: '171.01' })
  assert.equal(text, 'Ready to ship.\n\nSay the word.')
  assert.equal(posted[0].get('channel'), 'C0OPS')
  assert.equal(posted[0].get('thread_ts'), '171.01')
  const blocks = JSON.parse(posted[0].get('blocks') ?? '[]')
  assert.deepEqual(blocks.map((block: { type: string }) => block.type), ['header', 'section', 'table', 'actions'])
  assert.deepEqual(blocks[3].elements.map((button: { action_id: string }) => button.action_id), ['card:ok', 'card-link:logs'])
  assert.match(posted[0].get('text') ?? '', /Deploy #142/)
})

test('if Slack refuses the card, the reply carries it as text instead', async (t) => {
  fakeSlack(t, false)
  const { text } = await cardService.render({ agent: slacker, text: reply, channel: 'slack', chatId: 'C0OPS' })
  assert.match(text, /\*\*Deploy #142\*\*\nTests: 312 passed/)
})

test('other chats get the card as text: fields, a table, choices to reply with, and links', async () => {
  const { text } = await cardService.render({ agent: plain, text: reply, channel: 'whatsapp' })
  assert.equal(text, 'Ready to ship.\n\n**Deploy #142**\nTests: 312 passed\n```\nenv | p95\nprod | 210\n```\nReply with: Approve\nLogs: https://ci.example.com/142\n\nSay the word.')
})

test('a malformed card is dropped, never sent raw', async () => {
  const broken = 'Here.\n\n```spec\n{"op":"add","path":"/root","value":"c"}\n{"op":"add","path":"/elements/c","value":{"type":"Card","props":{}}}\n```'
  assert.deepEqual(await cardService.render({ agent: plain, text: broken, channel: 'telegram' }), { text: 'Here.' })
  assert.match((await cardService.render({ agent: plain, text: '```spec\nnot json\n```', channel: 'telegram' })).text, /malformed/)
})
