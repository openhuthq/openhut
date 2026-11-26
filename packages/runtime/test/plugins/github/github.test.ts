import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { github } from '../../../src/plugins/github/index.ts'
import { faceService } from '../../../src/plugins/github/faces.ts'
import { MARK } from '../../../src/plugins/github/sign.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { refresh, signIn } from '../../server/agents/signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_ghsignow', email: 'ghsign@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_ghsignag', name: 'Database', owner_id: 'usr_ghsignow', instructions: '#', model: 'claude:sonnet', net: 71, channel_key: seal('k'.repeat(48)) }).execute()
signIn({ email: 'ghsign@example.com' })
await refresh()
const actor = { id: 'usr_ghsignow', email: 'ghsign@example.com', role: 'owner' as const }
const call = (tool: string, args: Record<string, unknown>, kind = 'github') => github.connectorCall({ agentId: 'ag_ghsignag', kind, tool, args })

function png(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, data.length]), Buffer.from(type), data, Buffer.alloc(4)])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IEND', Buffer.alloc(0))])
}

test('a PR body gets the footer, text-only until the agent\'s face is saved', async () => {
  const sent = await call('create_pull_request', { owner: 'acme', repo: 'app', title: 'Index', body: 'Adds an index.' })
  assert.equal(sent.title, 'Index')
  assert.match(String(sent.body), /^Adds an index\.\n\n<!-- openhut -->\n---\n<sub>Opened by <b>Database<\/b>, an AI agent/)
  assert.deepEqual(await call('create_pull_request', { body: 'x' }, 'linear'), { body: 'x' })
  assert.deepEqual(await call('pull_request_read', { method: 'get' }), { method: 'get' })
})

test('the face is stored as a 64×64 PNG, uploaded once on first use, and only its hashed address reaches GitHub', async (t) => {
  await assert.rejects(faceService.save({ actor, agentId: 'ag_ghsignag', png: png(128).toString('base64') }), /64×64 PNG/)
  const face = png(64)
  const sha = createHash('sha256').update(face).digest('hex')
  assert.equal((await faceService.save({ actor, agentId: 'ag_ghsignag', png: face.toString('base64') })).sha256, sha)
  assert.equal((await faceService.get({ actor, agentId: 'ag_ghsignag' })).sha256, sha)
  const uploads: { url: string; body: Buffer; headers: Headers }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    uploads.push({ url: String(url), body: Buffer.from(init.body as Uint8Array), headers: new Headers(init.headers) })
    return Response.json({ url: `https://dl.openhut.dev/a/${sha}.png` }, { status: 201 })
  })
  const first = await call('issue_write', { method: 'create', title: 'Slow query', body: 'Seq scan.' })
  const again = await call('update_pull_request', { body: `Edited.\n\n${MARK}\nold footer` })
  assert.match(String(first.body), new RegExp(`<img src="https://dl.openhut.dev/a/${sha}.png" width="16" height="16"`))
  assert.equal(String(again.body).split(MARK).length, 2)
  assert.ok(String(again.body).startsWith('Edited.\n\n'))
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].url, 'https://openhut.dev/api/faces')
  assert.deepEqual(uploads[0].body, face)
  assert.deepEqual([...uploads[0].headers.keys()], ['content-type'])
})

test('only the agent\'s first comment in a thread is signed', async () => {
  const first = await call('add_issue_comment', { owner: 'acme', repo: 'app', issue_number: 12, body: 'Looking.' })
  const second = await call('add_issue_comment', { owner: 'acme', repo: 'app', issue_number: 12, body: 'Done.' })
  const other = await call('add_issue_comment', { owner: 'acme', repo: 'app', issue_number: 13, body: 'Hi.' })
  assert.match(String(first.body), /Opened by <b>Database<\/b>/)
  assert.equal(second.body, 'Done.')
  assert.match(String(other.body), /Opened by/)
})

test('agents with GitHub are told to add the OpenHut-Agent trailer to their commits', () => {
  const agent = { id: 'ag_ghsignag', name: 'Database', instructions: '', slots: {} as never, net: 71, code_execution: true, web_browser: false }
  const ctx = { agent, gateway: '', token: '', channelKey: '', channels: [], secrets: [] }
  assert.match(github.hermes({ ...ctx, connections: [{ name: 'GitHub', kind: 'github' }] }).prompt ?? '', /git commit --trailer "OpenHut-Agent: Database"/)
  assert.equal(github.hermes({ ...ctx, connections: [{ name: 'Linear', kind: 'linear' }] }).prompt, '')
})

test('with signing turned off in Admin, bodies go to GitHub as written', async () => {
  await settings.setGithubFooter(false)
  assert.deepEqual(await call('create_pull_request', { title: 'Index', body: 'Adds an index.' }), { title: 'Index', body: 'Adds an index.' })
  await settings.setGithubFooter(true)
  assert.match(String((await call('create_pull_request', { body: 'Adds an index.' })).body), /<!-- openhut -->/)
})
