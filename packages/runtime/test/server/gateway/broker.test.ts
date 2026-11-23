import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

const held: ServerResponse[] = []
const fake = createServer((req, res) => void upstream(req, res))
fake.listen(0, '127.0.0.1')
await once(fake, 'listening')
const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
const { config } = await import('../../../src/server/platform/config.ts')
Object.assign(config, { anthropicApi: fakeUrl, telegramApi: fakeUrl, openaiApi: fakeUrl, slackApi: `${fakeUrl}/api`, slackFiles: fakeUrl })

const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { agentToken, seal } = await import('../../../src/server/platform/secrets.ts')
const { settings } = await import('../../../src/server/platform/settings.ts')
const { seatLimits } = await import('../../../src/server/admin/seat-limits.ts')
const { gatewayServer } = await import('../../../src/server/gateway/gateway-server.ts')
const { brokerService, upstreams } = await import('../../../src/server/gateway/broker.ts')
const { agentService } = await import('../../../src/server/agents/agent-service.ts')

await migrate()
await db.insertInto('person').values({ id: 'usr_brokerow', email: 'broker@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_brokertt', name: 'Dev', owner_id: 'usr_brokerow', instructions: '# Dev', model: 'sonnet', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
await db.insertInto('channel').values({ id: 'ch_brokertg', agent_id: 'ag_brokertt', kind: 'telegram', status: 'connected', owner_address: '111', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: '123456:REAL-bot-token' })) }).execute()
await db.insertInto('channel').values({ id: 'ch_brokersl', agent_id: 'ag_brokertt', kind: 'slack', status: 'connected', owner_address: '', open: false, allowed: 'C012ABCDEF', secrets: seal(JSON.stringify({ botToken: 'xoxb-REAL-bot', appToken: 'xapp-REAL-app' })) }).execute()
await settings.setSeatToken('sk-ant-oat01-the-real-seat')
const token = agentToken({ id: 'ag_brokertt', epoch: 0 })
const gateway = gatewayServer.create().listen(0, '127.0.0.1')
await once(gateway, 'listening')
const gw = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
after(() => {
  gateway.close()
  fake.close()
})

const send = (path: string, init: RequestInit = {}) => fetch(`${gw}${path}`, { method: 'POST', ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } })
const events = () => db.selectFrom('connection_event').select(['tool', 'reason', 'outcome']).where('agent_id', '=', 'ag_brokertt').orderBy('id').execute()

test('the agent\'s own auth headers never reach the upstream; the seat does, with the rest of the request', async () => {
  const res = await send('/u/anthropic/v1/messages?beta=true', { headers: { 'x-api-key': 'sk-ant-api-leak', cookie: 'a=b', 'anthropic-beta': 'oauth-2025-04-20' }, body: '{"model":"sonnet"}' })
  const seen = await echoed(res)
  assert.equal(res.status, 200)
  assert.equal(seen.url, '/v1/messages?beta=true')
  assert.equal(seen.headers.authorization, 'Bearer sk-ant-oat01-the-real-seat')
  assert.equal(seen.headers['x-api-key'], undefined)
  assert.equal(seen.headers.cookie, undefined)
  assert.equal(seen.headers['anthropic-beta'], 'oauth-2025-04-20')
  assert.equal(seen.body, '{"model":"sonnet"}')
  assert.deepEqual(seatLimits.latest(), [{ kind: 'five_hour', percent: 42, resetsAt: null }])
  assert.deepEqual((await events()).at(-1), { tool: 'anthropic POST /v1/messages', reason: 'HTTP 200', outcome: 'allowed' })
})

test('only allowed paths pass, and a refusal is audited', async () => {
  assert.equal((await send('/u/anthropic/v1/models', { method: 'GET' })).status, 403)
  assert.equal((await send('/u/anthropic/v1/messages/../complete')).status, 403)
  assert.equal((await send('/u/anthropic/v1/%6Dessages')).status, 403)
  assert.equal((await send('/u/nowhere/v1/messages')).status, 404)
  assert.deepEqual((await events()).at(-1), { tool: 'anthropic POST /v1/%6Dessages', reason: 'Not on the allowed list', outcome: 'denied' })
})

test('a forged token gets 401, and so does the old token right after a revoke', async () => {
  const forged = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
  assert.equal((await fetch(`${gw}/u/anthropic/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${forged}` } })).status, 401)
  await db.insertInto('agent').values({ id: 'ag_brokerrv', name: 'Gone', owner_id: 'usr_brokerow', instructions: '# Gone', model: 'claude:sonnet', net: 10, channel_key: seal('k'.repeat(32)) }).execute()
  const old = agentToken({ id: 'ag_brokerrv', epoch: 0 })
  const ask = (bearer: string) => fetch(`${gw}/u/anthropic/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: '{}' })
  assert.equal((await ask(old)).status, 200)
  const { signIn } = await import('../agents/signed-in.ts')
  const { runSet } = await import('../../../src/server/cloud/run-set.ts')
  signIn({ email: 'broker@example.com' })
  await runSet.refresh()
  await agentService.revokeToken({ actor: { id: 'usr_brokerow', email: 'broker@example.com', local: false }, id: 'ag_brokerrv' })
  assert.equal((await ask(old)).status, 401)
  assert.equal((await ask(agentToken({ id: 'ag_brokerrv', epoch: 1 }))).status, 200)
})

test('a 5 MB reply streams through whole', async () => {
  const res = await send('/u/anthropic/v1/messages', { headers: { 'x-test': 'big' }, body: '{}' })
  assert.equal((await res.arrayBuffer()).byteLength, 5 * 1024 * 1024)
})

test('the ninth request at once gets 429, and the eight it held still finish', async () => {
  const open = Array.from({ length: 8 }, () => send('/u/anthropic/v1/messages', { headers: { 'x-test': 'hold' }, body: '{}' }))
  for (let i = 0; held.length < 8 && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal((await send('/u/anthropic/v1/messages', { body: '{}' })).status, 429)
  for (const res of held.splice(0)) res.end('done')
  for (const res of await Promise.all(open)) assert.equal(await res.text(), 'done')
})

test('a stream lasts as long as bytes keep coming, and a silent upstream is cut after the idle timeout', async () => {
  const server = createServer((req, res) => void brokerService.forward({
    agent: { id: 'ag_brokertt', owner_id: 'usr_brokerow', net: 9 }, upstream: upstreams.get('anthropic')!, path: '/v1/messages', req, res, idleMs: 300,
  }).catch(() => res.destroy())).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const t0 = Date.now()
  const drip = await (await fetch(url, { method: 'POST', headers: { 'x-test': 'drip' }, body: '{}' })).text()
  assert.equal(drip, 'x'.repeat(15))
  assert.ok(Date.now() - t0 >= 1400)
  await assert.rejects(fetch(url, { method: 'POST', headers: { 'x-test': 'silent' }, body: '{}' }).then((res) => res.text()))
  server.close()
})

test('Telegram: the stand-in in the path becomes the bot token, logOut, close and setWebhook are refused, polling is one audit row a minute', async () => {
  const bot = `/u/telegram/bot${token}`
  const seen = await echoed(await fetch(`${gw}${bot}/getMe`))
  assert.equal(seen.url, '/bot123456:REAL-bot-token/getMe')
  for (const method of ['logOut', 'close', 'setWebhook', 'LOGOUT', 'log%4Fut', 'set%57ebhook', 'setWebhook%20']) assert.equal((await fetch(`${gw}${bot}/${method}`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${gw}/u/telegram/bot${token.slice(0, -1)}x/getMe`)).status, 401)
  const before = (await events()).length
  for (let i = 0; i < 3; i++) await (await fetch(`${gw}${bot}/getUpdates?timeout=0`)).text()
  const polls = (await events()).slice(before)
  assert.deepEqual(polls, [{ tool: 'telegram GET /bot…/getUpdates', reason: 'HTTP 200', outcome: 'allowed' }])
  assert.ok((await events()).every((event) => !event.tool.includes('REAL') && !event.tool.includes(token)))
})

test('an API-key provider: the gateway adds the real key, passes chat, responses and models only, and refuses a provider with no key', async () => {
  await settings.setProviderKey('openai', 'sk-openai-the-real-key')
  const chat = await echoed(await send('/u/openai/v1/chat/completions', { headers: { 'x-api-key': 'leak', 'openai-organization': 'org-x' }, body: '{"model":"gpt-5.5"}' }))
  assert.equal(chat.url, '/v1/chat/completions')
  assert.equal(chat.headers.authorization, 'Bearer sk-openai-the-real-key')
  assert.equal(chat.headers['x-api-key'], undefined)
  assert.equal(chat.body, '{"model":"gpt-5.5"}')
  assert.equal((await send('/u/openai/v1/models', { method: 'GET' })).status, 200)
  assert.equal((await send('/u/openai/v1/files', { method: 'GET' })).status, 403)
  assert.equal((await send('/u/openai/v1/fine_tuning/jobs')).status, 403)
  const none = await send('/u/openrouter/v1/chat/completions', { body: '{}' })
  assert.equal(none.status, 409)
  assert.match(await none.text(), /OpenRouter isn't connected on this computer/)
})

test('Codex: the gateway adds the ChatGPT access token and account', async () => {
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } })).toString('base64url')
  await settings.setCodexTokens({ accessToken: `h.${claims}.s`, refreshToken: 'r1' })
  const server = createServer((req, res) => void brokerService.forward({
    agent: { id: 'ag_brokertt', owner_id: 'usr_brokerow', net: 9 }, upstream: { ...upstreams.get('codex')!, origin: fakeUrl }, path: req.url ?? '/', req, res,
  }).catch(() => res.destroy())).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const seen = await echoed(await fetch(`${url}/models`, { headers: { authorization: `Bearer ${token}` } }))
  assert.equal(seen.headers.authorization, `Bearer h.${claims}.s`)
  assert.equal(seen.headers['chatgpt-account-id'], 'acct-1')
  server.close()
})

const echoed = (res: Response) => res.json() as Promise<{ url: string; headers: Record<string, string | undefined>; body: string }>

async function upstream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  switch (req.headers['x-test']) {
    case 'big':
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      for (let i = 0; i < 5; i++) res.write(Buffer.alloc(1024 * 1024, 120))
      res.end()
      return
    case 'hold':
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.flushHeaders()
      held.push(res)
      return
    case 'drip':
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (let i = 0; i < 15; i++) {
        res.write('x')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      res.end()
      return
    case 'silent':
      return
  }
  res.writeHead(200, { 'content-type': 'application/json', 'anthropic-ratelimit-unified-5h-utilization': '0.42' })
  res.end(JSON.stringify({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }))
}

test('Slack gets stand-in tokens: the gateway knows the agent from them and swaps in the real bot or app token', async () => {
  const slack = (path: string, standIn: string, method = 'POST') => fetch(`${gw}${path}`, { method, headers: { authorization: `Bearer ${standIn}${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : 'channel=C012ABCDEF' })
  const bot = await echoed(await slack('/u/slack/api/chat.postMessage', 'xoxb-oh-'))
  assert.equal(bot.url, '/api/chat.postMessage')
  assert.equal(bot.headers.authorization, 'Bearer xoxb-REAL-bot')
  assert.equal((await echoed(await slack('/u/slack/api/apps.connections.open', 'xapp-oh-'))).headers.authorization, 'Bearer xapp-REAL-app')
  const file = await echoed(await slack('/u/slackfiles/files-pri/T012-F034/report.pdf', 'xoxb-oh-', 'GET'))
  assert.equal(file.url, '/files-pri/T012-F034/report.pdf')
  assert.equal(file.headers.authorization, 'Bearer xoxb-REAL-bot')
  assert.equal((await slack('/u/slack/api/../admin', 'xoxb-oh-')).status, 403)
  assert.equal((await slack('/u/slackfiles/files-pri/T012-F034/x', 'xoxb-oh-')).status, 403)
  assert.equal((await fetch(`${gw}/u/slack/api/auth.test`, { method: 'POST', headers: { authorization: 'Bearer xoxb-oh-ag_nobody00.forged' } })).status, 401)
})
