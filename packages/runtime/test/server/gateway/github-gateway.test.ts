import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { execFileSync, spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const GITHUB_TOKEN = 'ghs_installation-token'
const root = mkdtempSync(join(tmpdir(), 'openhut-git-'))
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' })
git(root, 'init', '-q', '--bare', '-b', 'main', 'acme/api.git')
const seed = join(root, 'seed')
git(root, 'init', '-q', '-b', 'main', seed)
git(seed, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '--allow-empty', '-m', 'first')
git(seed, 'push', '-q', join(root, 'acme/api.git'), 'main')
const auths: string[] = []
const fake = createServer((req, res) => void backend(req, res))
fake.listen(0, '127.0.0.1')
await once(fake, 'listening')

const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { agentToken, seal } = await import('../../../src/server/platform/secrets.ts')
const { gatewayServer } = await import('../../../src/server/gateway/gateway-server.ts')
const { upstreams } = await import('../../../src/server/gateway/broker.ts')
const { github, GIT_SPECS } = await import('../../../src/server/integrations/github/github.ts')
const { permissions } = await import('../../../src/server/permissions/permissions.ts')
const { connectionService } = await import('../../../src/server/connections/connection-service.ts')
upstreams.get('github')!.origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

await migrate()
const { settings } = await import('../../../src/server/platform/settings.ts')
await settings.setGithubApp({ id: 42, slug: 'acme-hut', name: 'acme-hut', owner: 'acme', ownerType: 'Organization', ownerAvatar: '', pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), botId: 99 })
const app = { installationId: 7 }
await db.insertInto('person').values({ id: 'usr_gitowner', email: 'git@example.com', role: 'owner', removed_at: null }).execute()
for (const [id, net] of [['ag_gitgrant', 11], ['ag_gitnone0', 12]] as const) await db.insertInto('agent').values({ id, name: id, owner_id: 'usr_gitowner', instructions: '#', model: 'sonnet', net, channel_key: seal('k'.repeat(32)) }).execute()
await db.insertInto('connection').values({ id: 'cn_gitgithub', kind: 'github', name: 'GitHub', owner_id: 'usr_gitowner', config: seal(JSON.stringify(app)), created_at: new Date() }).execute()
await db.insertInto('connection_grant').values({ id: 'gr_gitgrant', connection_id: 'cn_gitgithub', agent_id: 'ag_gitgrant', created_at: new Date() }).execute()
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => String(url).startsWith('https://api.github.com/')
  ? Response.json({ token: GITHUB_TOKEN }, { status: 201 })
  : realFetch(url, init)) as typeof fetch
const gateway = gatewayServer.create().listen(0, '127.0.0.1')
await once(gateway, 'listening')
const gw = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
after(() => {
  globalThis.fetch = realFetch
  gateway.close()
  fake.close()
})
const ask = (agent: string, path: string, method = 'GET') => realFetch(`${gw}/u/github${path}`, { method, headers: { authorization: `Agent ${agentToken({ id: agent, epoch: 0 })}` } })
const owner = { id: 'usr_gitowner', email: 'git@example.com', role: 'owner' as const }
const gitPermission = (state: 'allow' | 'ask' | 'deny', tools = ['git_read', 'git_push']) => permissions.set({ actor: owner, agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub', tools, state })
const events = () => db.selectFrom('connection_event').select(['tool', 'outcome']).where('agent_id', '=', 'ag_gitgrant').orderBy('id').execute()

test('git_read hands out config only: no GitHub token in the reply or in ~/.gitconfig, and plain git clones and pushes through the gateway', async () => {
  await gitPermission('allow')
  const reply = await github.connector.call({ config: app, refresh: async () => ({}), tool: 'git_read', args: {} })
  assert.ok(!reply.text.includes('ghs_'))
  const home = mkdtempSync(join(tmpdir(), 'openhut-agent-home-'))
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', OPENHUT_GATEWAY: gw, OPENHUT_AGENT_TOKEN: agentToken({ id: 'ag_gitgrant', epoch: 0 }) }
  for (const line of reply.text.split('\n').filter((each) => each.startsWith('git config'))) execFileSync('sh', ['-c', line], { env })
  const run = (cwd: string, ...args: string[]) => new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd, env })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`git ${args.join(' ')}: ${output}`)))
  })
  await run(home, 'clone', '-q', 'https://github.com/acme/api.git', 'api')
  await run(join(home, 'api'), 'commit', '-q', '--allow-empty', '-m', 'from the agent')
  await run(join(home, 'api'), 'push', '-q', 'origin', 'main')
  assert.equal(git(join(root, 'acme/api.git'), 'log', '-1', '--format=%s %an', 'main').trim(), 'from the agent acme-hut[bot]')
  assert.ok(auths.length >= 4 && auths.every((auth) => auth === `Basic ${Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64')}`))
  assert.ok(!readFileSync(join(home, '.gitconfig'), 'utf8').includes(GITHUB_TOKEN))
  assert.deepEqual(await events(), [{ tool: 'github fetch from acme/api', outcome: 'allowed' }, { tool: 'github push to acme/api', outcome: 'allowed' }])
})

test('git is two permissions: Read code and Push branches; Never refuses, Ask first pushes only once approved, Always pushes', async (t) => {
  const connection = { id: 'cn_gitgithub', kind: 'github' as const, name: 'GitHub' }
  t.mock.method(connectionService, 'tools', async () => GIT_SPECS.map((spec) => ({ name: `github_${spec.name}`, connection, spec })))
  const push = () => ask('ag_gitgrant', '/acme/api.git/git-receive-pack', 'POST')
  const pushRefs = () => ask('ag_gitgrant', '/acme/api.git/info/refs?service=git-receive-pack')
  const fetchRefs = () => ask('ag_gitgrant', '/acme/api.git/info/refs?service=git-upload-pack')
  await permissions.reset({ actor: owner, agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub' })
  const listed = await permissions.list({ agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub', tools: GIT_SPECS })
  assert.deepEqual(listed.map((each) => [each.name, each.description, each.group, each.permission]), [['git_read', 'Read code', 'read', 'allow'], ['git_push', 'Push branches', 'create', 'ask']])
  assert.equal((await fetchRefs()).status, 200)
  const refused = await pushRefs()
  assert.equal(refused.status, 403)
  assert.match(await refused.text(), /Pushing to acme\/api waits for your owner's OK\. Call call_tool github_git_push with repo acme\/api/)
  assert.equal((await push()).status, 403)
  const asked = await connectionService.call({ agent: { id: 'ag_gitgrant', owner_id: 'usr_gitowner' }, name: 'github_git_push', args: { repo: 'acme/api', branch: 'fix-docs', files: [{ path: 'CHANGELOG.md', added: 3, removed: 1 }] }, reason: 'Fix the changelog', origin: { platform: 'api_server', chat_id: 'openhut-git' } })
  assert.match(asked.text, /\): Push to GitHub · acme\/api \(fix-docs\)\./)
  const pushAsk = await db.selectFrom('ask').select('input').where('id', '=', /ask_[a-z0-9]+/.exec(asked.text)?.[0] ?? '').executeTakeFirstOrThrow()
  assert.deepEqual((JSON.parse(pushAsk.input) as { arguments: unknown }).arguments, { repo: 'acme/api', branch: 'fix-docs', files: [{ path: 'CHANGELOG.md', added: 3, removed: 1 }] }, 'the card can show the changed files')
  assert.equal((await pushRefs()).status, 403, 'not until the owner answers')
  await db.updateTable('ask').set({ status: 'done', answered_at: new Date() }).where('id', '=', /ask_[a-z0-9]+/.exec(asked.text)?.[0] ?? '').execute()
  assert.equal((await pushRefs()).status, 200, 'allowed once opens a short window for that repo')
  assert.equal((await ask('ag_gitgrant', '/acme/other.git/info/refs?service=git-receive-pack')).status, 403, 'and only that repo')
  await gitPermission('deny', ['git_push'])
  assert.equal((await fetchRefs()).status, 200)
  assert.equal((await pushRefs()).status, 403)
  const blocked = connectionService.callsSince({ agentId: 'ag_gitgrant', since: 0 }).at(-1)
  assert.deepEqual([blocked?.outcome, blocked?.connectionId, blocked?.spec?.name], ['denied', 'cn_gitgithub', 'git_push'])
  await gitPermission('deny')
  assert.equal((await fetchRefs()).status, 403)
  await gitPermission('allow')
  assert.equal((await fetchRefs()).status, 200)
  assert.equal((await pushRefs()).status, 200)
})

test('the old git_credentials setting splits in two: Never and Always carry over to both, Ask first keeps the defaults', async () => {
  const { splitGitPermission } = await import('../../../src/plugins/github/tables.ts')
  await permissions.reset({ actor: owner, agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub' })
  const states = async () => (await db.selectFrom('tool_permission').select(['tool', 'state']).where('agent_id', '=', 'ag_gitgrant').orderBy('tool').execute()).map((row) => [row.tool, row.state])
  for (const [old, after] of [['deny', [['git_push', 'deny'], ['git_read', 'deny']]], ['allow', [['git_push', 'allow'], ['git_read', 'allow']]], ['ask', []]] as const) {
    await permissions.reset({ actor: owner, agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub' })
    await gitPermission(old, ['git_credentials'])
    await splitGitPermission(db)
    assert.deepEqual(await states(), after)
  }
})

test('only git smart HTTP passes, and only for an agent granted GitHub', async () => {
  assert.equal((await ask('ag_gitgrant', '/acme/api/info/refs?service=git-upload-pack')).status, 200)
  for (const [path, method] of [
    ['/acme/api.git/info/refs', 'POST'], ['/acme/api.git/git-receive-pack', 'GET'], ['/acme/api/settings', 'GET'], ['/login', 'GET'],
    ['/acme/api/raw/main/x', 'GET'], ['/.x/api/info/refs', 'GET'], ['/acme/api/info/refs/x', 'GET'],
  ]) assert.equal((await ask('ag_gitgrant', path, method)).status, 403, path)
  assert.equal((await ask('ag_gitnone0', '/acme/api.git/info/refs')).status, 403)
  assert.equal((await realFetch(`${gw}/u/github/acme/api.git/info/refs`)).status, 401)
})

async function backend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  auths.push(String(req.headers.authorization))
  if (req.headers.authorization !== `Basic ${Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64')}`) return void res.writeHead(401).end()
  const url = new URL(req.url ?? '/', 'http://github')
  const cgi = spawn('git', ['http-backend'], {
    env: {
      PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REMOTE_USER: 'bot', GIT_CONFIG_NOSYSTEM: '1', HOME: root,
      REQUEST_METHOD: req.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), CONTENT_TYPE: req.headers['content-type'] ?? '',
      HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '', HTTP_GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
    },
  })
  req.pipe(cgi.stdin)
  const chunks: Buffer[] = []
  for await (const chunk of cgi.stdout) chunks.push(chunk)
  const out = Buffer.concat(chunks)
  const split = out.indexOf('\r\n\r\n')
  const headers = Object.fromEntries(out.subarray(0, split).toString().split('\r\n').map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]))
  const status = Number(String(headers.status ?? '200').split(' ')[0])
  delete headers.status
  res.writeHead(status, headers).end(out.subarray(split + 4))
}
