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
const { github } = await import('../../../src/server/integrations/github/github.ts')
const { permissions } = await import('../../../src/server/permissions/permissions.ts')
upstreams.get('github')!.origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

await migrate()
const app = { appId: 42, slug: 'acme-hut', pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), installationId: 7, botId: 99 }
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
const gitPermission = (state: 'allow' | 'ask' | 'deny') => permissions.set({ actor: { id: 'usr_gitowner', email: 'git@example.com', role: 'owner' }, agentId: 'ag_gitgrant', connectionId: 'cn_gitgithub', tools: ['git_credentials'], state })
const events = () => db.selectFrom('connection_event').select(['tool', 'outcome']).where('agent_id', '=', 'ag_gitgrant').orderBy('id').execute()

test('git_credentials hands out config only: no GitHub token in the reply or in ~/.gitconfig, and plain git clones and pushes through the gateway', async () => {
  await gitPermission('allow')
  const reply = await github.connector.call({ config: app, refresh: async () => ({}), tool: 'git_credentials', args: {} })
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

test('git_credentials gates git: Never refuses everything, Ask fetches but refuses push, Always pushes', async () => {
  const push = () => ask('ag_gitgrant', '/acme/api.git/git-receive-pack', 'POST')
  const pushRefs = () => ask('ag_gitgrant', '/acme/api.git/info/refs?service=git-receive-pack')
  const fetchRefs = () => ask('ag_gitgrant', '/acme/api.git/info/refs?service=git-upload-pack')
  await gitPermission('ask')
  assert.equal((await fetchRefs()).status, 200)
  const refused = await pushRefs()
  assert.equal(refused.status, 403)
  assert.match(await refused.text(), /Pushing needs git_credentials set to Always/)
  assert.equal((await push()).status, 403)
  await gitPermission('deny')
  assert.equal((await fetchRefs()).status, 403)
  assert.equal((await pushRefs()).status, 403)
  await gitPermission('allow')
  assert.equal((await fetchRefs()).status, 200)
  assert.equal((await pushRefs()).status, 200)
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
