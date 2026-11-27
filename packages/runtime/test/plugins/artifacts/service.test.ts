import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import type { AddressInfo } from 'node:net'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { artifacts } from '../../../src/plugins/artifacts/index.ts'
import { artifactController, fileController, shareController } from '../../../src/plugins/artifacts/routes.ts'
import { artifactService, cleanPath, kindOf, roleOf, sign, verify } from '../../../src/plugins/artifacts/service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { config } from '../../../src/server/platform/config.ts'
import { webApp } from '../../../src/server/platform/web-app.ts'
import { agentToken, seal, sha } from '../../../src/server/platform/secrets.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_artown', email: 'own@example.com', role: 'member', removed_at: null },
  { id: 'usr_artpal', email: 'pal@example.com', role: 'member', removed_at: null },
  { id: 'usr_artout', email: 'out@example.com', role: 'member', removed_at: null },
]).execute()
await db.insertInto('agent').values({ id: 'ag_artone', name: 'Ops', owner_id: 'usr_artown', owner: 'own@example.com', shared: false, instructions: '#', model: 'sonnet', net: 120, channel_key: seal('k'.repeat(48)) }).execute()
await db.insertInto('agent').values({ id: 'ag_arttwo', name: 'Growth', owner_id: 'usr_artown', owner: 'own@example.com', shared: false, instructions: '#', model: 'sonnet', net: 121, channel_key: seal('k'.repeat(48)) }).execute()
for (const who of ['own', 'pal', 'out']) await db.insertInto('session').values({ hash: sha(`tok-${who}`), person_id: `usr_art${who}`, expires_at: new Date(Date.now() + 60_000) }).execute()
const owner = { id: 'usr_artown', email: 'own@example.com', role: 'member' as const }
const pal = { id: 'usr_artpal', email: 'pal@example.com', role: 'member' as const }
const outsider = { id: 'usr_artout', email: 'out@example.com', role: 'member' as const }
const as = (who: string) => ({ cookie: `openhut_session=tok-${who}` })

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
app.addHook('onSend', async (_req, reply) => { reply.header('x-frame-options', 'DENY') })
await app.register(artifactController, { prefix: '/api/artifacts' })
await app.register(shareController, { prefix: '/api/share' })
await app.register(fileController, { prefix: '/a' })
app.setNotFoundHandler(webApp)
config.appDir = mkdtempSync(join(tmpdir(), 'oh-app-'))
writeFileSync(join(config.appDir, 'index.html'), '<div id="root"></div>')
test.after(() => app.close())

const page = '<html><head><title>Order sync failures</title></head><body><script src="chart.js"></script></body></html>'

test('paths are cleaned and .. is refused', () => {
  assert.equal(cleanPath('./assets//chart.js'), 'assets/chart.js')
  assert.equal(cleanPath('/index.html'), 'index.html')
  assert.equal(cleanPath('a\\b.css'), 'a/b.css')
  assert.throws(() => cleanPath('../secrets'), /outside the artifact/)
  assert.throws(() => cleanPath('a/../../b'), /outside the artifact/)
  assert.throws(() => cleanPath('./'), /1 to 200/)
  assert.equal(kindOf('report.PDF'), 'pdf')
  assert.equal(kindOf('data.csv'), 'file')
})

test('who can see: agent users manage, named people and the team view, a link needs the token', () => {
  const base = { people: ['pal@example.com'] }
  for (const access of ['private', 'team', 'link'] as const) {
    assert.equal(roleOf({ uses: true, email: 'own@example.com', access, ...base }), 'manage')
    assert.equal(roleOf({ uses: false, email: 'Pal@example.com', access, ...base }), 'view')
    assert.equal(roleOf({ uses: false, access, holdsToken: false, ...base }), undefined)
  }
  assert.equal(roleOf({ uses: false, email: 'out@example.com', access: 'private', ...base }), undefined)
  assert.equal(roleOf({ uses: false, email: 'out@example.com', access: 'team', ...base }), 'view')
  assert.equal(roleOf({ uses: false, email: 'out@example.com', access: 'link', ...base }), 'view')
  assert.equal(roleOf({ uses: false, access: 'link', holdsToken: true, ...base }), 'view')
  assert.equal(roleOf({ uses: false, access: 'team', holdsToken: true, ...base }), undefined)
})

test('a signature expires and can\'t be moved to another artifact or changed', () => {
  const now = Date.UTC(2026, 10, 27, 10)
  const sig = sign({ id: 'art_one', now })
  assert.ok(verify({ id: 'art_one', sig, now }))
  assert.ok(verify({ id: 'art_one', sig, now: now + 12 * 3600_000 - 1 }))
  assert.ok(!verify({ id: 'art_one', sig, now: now + 13 * 3600_000 }))
  assert.ok(!verify({ id: 'art_two', sig, now }))
  const [exp, mac] = sig.split('.')
  assert.ok(!verify({ id: 'art_one', sig: `${Number(exp) + 3600}.${mac}`, now }))
  assert.ok(!verify({ id: 'art_one', sig: `${exp}.${mac!.slice(0, -1)}A`, now }))
  assert.ok(!verify({ id: 'art_one', sig: 'nope', now }))
})

test('publish needs an entry, keeps to the limits, and a stale ver saves nothing', async () => {
  await assert.rejects(artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'a.css', text: '' }, { path: 'b.js', text: '' }] }), /index.html, or exactly one file/)
  await assert.rejects(artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: '../x.html', text: '' }] }), /outside/)
  await assert.rejects(artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'big.bin', base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }] }), /10 MB/)
  const since = new Date()
  const made = await artifactService.publish({ agentId: 'ag_artone', threadId: 'th_a', createdBy: 'usr_artown', files: [{ path: 'index.html', text: page }, { path: 'chart.js', text: 'draw()' }] })
  assert.deepEqual({ title: made.title, ver: made.ver, entry: made.entry, kind: made.kind, access: made.access }, { title: 'Order sync failures', ver: 1, entry: 'index.html', kind: 'page', access: 'private' })
  assert.equal(artifactService.card({ agentId: 'ag_artone', threadId: 'th_b', since }), undefined)
  assert.deepEqual(artifactService.card({ agentId: 'ag_artone', threadId: 'th_a', since }), { type: 'data-artifact', data: { id: made.id, title: made.title, kind: 'page', access: 'private', size: Buffer.byteLength(page) } })
  assert.equal(artifactService.card({ agentId: 'ag_artone', threadId: 'th_a', since }), undefined)
  const next = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', artifact: made.id, ver: 1, files: [{ path: 'chart.js', text: 'drawMore()' }] })
  assert.equal(next.ver, 2)
  await assert.rejects(artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', artifact: made.id, ver: 1, files: [{ path: 'chart.js', text: 'lost' }] }), /Changed since you read it \(now v2\)/)
  assert.equal(await artifactService.read({ agentId: 'ag_artone', artifact: made.id, path: 'chart.js' }), 'drawMore()')
  await assert.rejects(artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', artifact: made.id, remove: ['index.html'], files: [] }), /Keep index.html/)
  await assert.rejects(artifactService.publish({ agentId: 'ag_arttwo', createdBy: 'usr_artown', artifact: made.id, files: [{ path: 'x.js', text: '' }] }), /no artifact/)
  assert.equal(JSON.parse(await artifactService.read({ agentId: 'ag_artone', artifact: made.id })).files.length, 2)
  assert.match(await artifacts.tools.list_artifacts.run({}, { agent: { id: 'ag_artone', owner_id: 'usr_artown', net: 120 }, origin: {} }) as string, new RegExp(`${made.id} · Order sync failures · ver 2 · private`))
})

test('over HTTP: the owner opens and shares, others get 404 until it is shared, and files carry the sandbox', async () => {
  const made = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'index.html', text: page }, { path: 'chart.js', text: 'draw()' }] })
  const view = (await app.inject({ url: `/api/artifacts/${made.id}`, headers: as('own') })).json()
  assert.equal(view.canManage, true)
  assert.equal((await app.inject({ url: `/api/artifacts/${made.id}`, headers: as('out') })).statusCode, 404)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/artifacts/${made.id}`, headers: as('out'), payload: { access: 'link' } })).statusCode, 404)
  assert.deepEqual((await app.inject({ url: '/api/artifacts?agent=ag_artone', headers: as('out') })).json(), [])

  const shared = (await app.inject({ method: 'PATCH', url: `/api/artifacts/${made.id}`, headers: as('own'), payload: { add: ['Pal@example.com'] } })).json()
  assert.deepEqual(shared.people, ['pal@example.com'])
  const palView = (await app.inject({ url: `/api/artifacts/${made.id}`, headers: as('pal') })).json()
  assert.deepEqual({ canManage: palView.canManage, people: palView.people }, { canManage: false, people: [] })
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/artifacts/${made.id}`, headers: as('pal') })).statusCode, 403)

  const linked = (await app.inject({ method: 'PATCH', url: `/api/artifacts/${made.id}`, headers: as('own'), payload: { access: 'link' } })).json()
  const token = linked.shareUrl.split('/').at(-1)
  const open = (await app.inject({ url: `/api/share/${token}` })).json()
  assert.deepEqual({ title: open.title, agentName: open.agentName, kind: open.kind }, { title: 'Order sync failures', agentName: 'Ops', kind: 'page' })
  const reset = (await app.inject({ method: 'POST', url: `/api/artifacts/${made.id}/link`, headers: as('own') })).json()
  assert.notEqual(reset.shareUrl, linked.shareUrl)
  assert.equal((await app.inject({ url: `/api/share/${token}` })).statusCode, 404)
  await app.inject({ method: 'PATCH', url: `/api/artifacts/${made.id}`, headers: as('own'), payload: { access: 'private' } })
  assert.equal((await app.inject({ url: `/api/share/${reset.shareUrl.split('/').at(-1)}` })).statusCode, 404)

  const res = await app.inject({ url: view.src })
  assert.equal(res.body, page)
  assert.equal(res.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors \'self\'')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.headers['cache-control'], 'private, no-cache')
  assert.equal(res.headers['x-frame-options'], undefined)
  const base = view.src.replace(/index\.html$/, '')
  assert.equal((await app.inject({ url: `${base}chart.js` })).body, 'draw()')
  assert.equal((await app.inject({ url: `${base}orders/lisbon` })).body, page)
  assert.equal((await app.inject({ url: `${base}missing.css` })).statusCode, 404)
  assert.equal((await app.inject({ url: `/a/${made.id}/${sign({ id: 'art_other' })}/index.html` })).statusCode, 404)

  const pdf = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'q4.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') }] })
  const pdfRes = await app.inject({ url: `/a/${pdf.id}/${sign({ id: pdf.id })}/q4.pdf` })
  assert.deepEqual([pdfRes.headers['content-type'], pdfRes.headers['content-disposition'], pdfRes.headers['content-security-policy']], ['application/pdf', 'inline', 'frame-ancestors \'self\''])
  const csv = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'failed orders.csv', text: 'a,b' }] })
  assert.equal((await app.inject({ url: `/a/${csv.id}/${sign({ id: csv.id })}/` })).headers['content-disposition'], 'attachment; filename="failed_orders.csv"')

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/artifacts/${made.id}`, headers: as('own') })).statusCode, 204)
  assert.equal((await app.inject({ url: view.src })).statusCode, 404)
})

test('the public /share page is the app, served without sign-in', async () => {
  const res = await app.inject({ url: '/share/some-token' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, '<div id="root"></div>')
  assert.match(String(res.headers['content-type']), /text\/html/)
})

test('a title the agent chose stays when it republishes, and a page without one follows its <title>', async () => {
  const named = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', title: 'Weekly sync report', files: [{ path: 'index.html', text: page }] })
  const again = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', artifact: named.id, files: [{ path: 'index.html', text: page.replace('Order sync failures', 'Something else') }] })
  assert.equal(again.title, 'Weekly sync report')
  const plain = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'index.html', text: page }] })
  const renamed = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', artifact: plain.id, files: [{ path: 'index.html', text: page.replace('Order sync failures', 'Order sync, fixed') }] })
  assert.equal(renamed.title, 'Order sync, fixed')
})

test('a folder path opens its index.html before the entry, and an odd signature is a 404, not an error', async () => {
  const site = await artifactService.publish({ agentId: 'ag_artone', createdBy: 'usr_artown', files: [{ path: 'index.html', text: page }, { path: 'docs/index.html', text: 'docs' }] })
  const base = `/a/${site.id}/${sign({ id: site.id })}/`
  assert.equal((await app.inject({ url: `${base}docs` })).body, 'docs')
  assert.equal((await app.inject({ url: `${base}docs/` })).body, 'docs')
  assert.equal((await app.inject({ url: `${base}elsewhere` })).body, page)
  const [exp, mac] = sign({ id: site.id }).split('.')
  assert.ok(!verify({ id: site.id, sig: `${exp}.${'é'.repeat(mac!.length)}` }))
  assert.equal((await app.inject({ url: `/a/${site.id}/${exp}.${encodeURIComponent('é'.repeat(mac!.length))}/index.html` })).statusCode, 404)
})

test('over the gateway an agent publishes a PDF of several MB, and the card waits in the app thread it came from', async () => {
  const server = gatewayServer.create().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const headers = { authorization: `Agent ${agentToken({ id: 'ag_artone', epoch: 0 })}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  try {
    const since = new Date()
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 32)]).toString('base64')
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'publish_artifact', arguments: { files: [{ path: 'contract.pdf', base64: pdf }], origin: { platform: 'api_server', chat_id: 'th_gw.2' } } } }
    const res = await fetch(`${base}/api/v1/mcp`, { method: 'POST', headers, body: JSON.stringify(call) })
    const text = ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text
    assert.match(text, /^Published "contract.pdf"/)
    assert.equal(artifactService.card({ agentId: 'ag_artone', threadId: 'th_other', since }), undefined)
    assert.equal(artifactService.card({ agentId: 'ag_artone', threadId: 'th_gw', since })?.data.kind, 'pdf')
    const slack = { ...call, params: { ...call.params, arguments: { files: [{ path: 'n.md', text: '# n' }], origin: { platform: 'slack', chat_id: 'C1' } } } }
    await fetch(`${base}/api/v1/mcp`, { method: 'POST', headers, body: JSON.stringify(slack) })
    assert.equal(artifactService.card({ agentId: 'ag_artone', threadId: 'C1', since }), undefined)
    assert.equal((await fetch(`${base}/turn-state`, { method: 'POST', headers, body: 'x'.repeat(2 << 20) })).status, 413)
  } finally {
    server.close()
  }
})
