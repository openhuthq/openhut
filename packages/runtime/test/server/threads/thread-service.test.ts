import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import { isUploadName } from '../../../src/agentd/files.ts'
import { agentd } from '../../../src/server/platform/agentd.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors, HttpError } from '../../../src/server/platform/http-error.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'
import { threadController } from '../../../src/server/threads/thread-controller.ts'
import { imageTypeOf, safeFileName, shownCall } from '../../../src/server/threads/thread-service.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_chatownr', email: 'owner@example.com', role: 'owner', removed_at: null },
]).execute()
await db.insertInto('agent').values([
  { id: 'ag_chatrunn', name: 'Runner', owner_id: 'usr_chatownr', instructions: '# Runner', model: 'sonnet', net: 21, channel_key: seal('k'.repeat(48)), wanted: 'running' },
  { id: 'ag_chatstop', name: 'Sleeper', owner_id: 'usr_chatownr', instructions: '# Sleeper', model: 'sonnet', net: 22, channel_key: seal('k'.repeat(48)) },
]).execute()

const seen: { auth?: string; session?: string; body?: { stream: boolean; messages: { role: string; content: unknown }[] } } = {}
const hermes = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    seen.auth = req.headers.authorization
    seen.session = String(req.headers['x-hermes-session-id'])
    seen.body = JSON.parse(raw)
    await db.insertInto('connection_event').values([
      { agent_id: 'ag_chatrunn', connection_id: null, tool: 'anthropic POST /v1/messages', reason: '', outcome: 'allowed', ms: 845 },
      { agent_id: 'ag_chatrunn', connection_id: null, tool: 'postgres_query', reason: 'count orders', outcome: 'allowed', ms: 12 },
      { agent_id: 'ag_chatrunn', connection_id: null, tool: 'telegram POST /bot…/sendMessage', reason: '', outcome: 'allowed', ms: 30 },
    ]).execute()
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (seen.body?.messages.at(-1)?.content === 'model down') return res.end(`data: ${JSON.stringify({ error: { message: 'HTTP 401: Claude Code is installed but has no usable login' } })}\n\n`)
    const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
    res.end(`: keepalive\n\n${chunk('Let me ')}${chunk('check.')}event: hermes.tool.progress\ndata: {"tool":"call_tool","label":"postgres_query"}\n\n${chunk('214 orders.')}data: [DONE]\n\n`)
  })
})
await new Promise<void>((resolve) => hermes.listen(18649, '127.0.0.1', resolve))

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validateWithZod)
await app.register(threadController, { prefix: '/api/threads' })
const as = () => ({ authorization: 'Bearer test-key' })
const newThread = async (agentId: string) => (await app.inject({ method: 'POST', url: '/api/threads', headers: as(), payload: { agentId } })).json()
const say = (threadId: string, text: string) => app.inject({
  method: 'POST', url: `/api/threads/${threadId}/chat`, headers: as(),
  payload: { trigger: 'submit-message', message: { id: `m${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] } },
})

test.after(() => { hermes.close(); return app.close() })

test('a turn streams the agent\'s reply in order, with its tool use and gateway calls, and is saved', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal(thread.title, 'Runner')
  const res = await say(thread.id, 'How many orders?')
  assert.equal(res.statusCode, 200)
  assert.equal(seen.auth, `Bearer ${'k'.repeat(48)}`)
  assert.equal(seen.session, `openhut-${thread.id}`)
  assert.deepEqual(seen.body?.messages.slice(1), [{ role: 'user', content: 'How many orders?' }])
  assert.equal(seen.body?.messages[0].role, 'system')
  assert.match(String(seen.body?.messages[0].content), /saved in \/opt\/data\/home\/uploads/)
  assert.equal(seen.body?.stream, true)
  const types = res.body.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)).type)
  assert.deepEqual(types, ['start', 'text-start', 'text-delta', 'text-delta', 'text-end', 'data-tool', 'text-start', 'text-delta', 'text-end', 'data-calls', 'finish'])
  const saved = (await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: as() })).json()
  assert.deepEqual(saved.messages.map((message: { role: string }) => message.role), ['user', 'assistant'])
  const answer = saved.messages[1].parts
  assert.deepEqual(answer.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text), ['Let me check.', '214 orders.'])
  assert.deepEqual(answer.find((part: { type: string }) => part.type === 'data-calls').data, [{ tool: 'postgres_query', connectionName: null, outcome: 'allowed', reason: 'count orders', ms: 12 }])
})

test('each person has one thread per agent, and Hermes keeps its history: a turn sends only the new message', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal((await newThread('ag_chatrunn')).id, thread.id)
  await say(thread.id, 'Second')
  assert.deepEqual(seen.body?.messages.slice(1), [{ role: 'user', content: 'Second' }])
  assert.equal(seen.session, `openhut-${thread.id}`)
  await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/chat`, headers: as(), payload: { trigger: 'regenerate-message' } })
  assert.deepEqual(seen.body?.messages.slice(1), [{ role: 'user', content: 'Second' }])
  const saved = (await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: as() })).json()
  assert.deepEqual(saved.messages.map((message: { role: string }) => message.role), ['user', 'assistant', 'user', 'assistant'])
})

test('threads need the enrolled key, and a stopped agent says so before anything is sent', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal((await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: { authorization: 'Bearer wrong' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/threads' })).statusCode, 401)
  const stopped = await newThread('ag_chatstop')
  const res = await say(stopped.id, 'hi')
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.message, 'Sleeper is stopped. Start it and try again.')
  const kept = (await app.inject({ method: 'GET', url: `/api/threads/${stopped.id}`, headers: as() })).json()
  assert.deepEqual(kept.messages.map((message: { role: string }) => message.role), ['user'])
})

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const saved = new Map<string, Buffer>()
const saveUpload = mock.method(agentd, 'saveUpload', async ({ name, body }: { id: string; name: string; body: Buffer }) => {
  saved.set(`uploads/${name}`, body)
  return { path: `uploads/${name}` }
})
mock.method(agentd, 'readFile', async ({ path }: { id: string; path: string }) => {
  const body = saved.get(path)
  return { body: body ? body.toString('base64') : null }
})
const removeUploads = mock.method(agentd, 'removeUploads', async ({ names }: { id: string; names: string[] }) => {
  const removed = names.filter((name) => saved.delete(`uploads/${name}`))
  return { removed }
})
mock.method(agentd, 'statFiles', async ({ paths }: { id: string; paths: string[] }) => {
  if (paths.some((path) => path.split('/').length > 32)) throw new HttpError(502, 'The agent runner couldn\'t look for the files: bad file paths.')
  return { files: paths.flatMap((path) => saved.has(path) ? [{ path, size: saved.get(path)?.length ?? 0 }] : []) }
})
const upload = ({ threadId, name, body, headers = as() }: { threadId: string; name: string; body: Buffer; headers?: Record<string, string> }) => app.inject({
  method: 'POST', url: `/api/threads/${threadId}/files?name=${encodeURIComponent(name)}&type=${name.endsWith('.png') ? 'image/png' : 'text/plain'}`,
  headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: body,
})
const sendParts = ({ threadId, parts }: { threadId: string; parts: Record<string, unknown>[] }) => app.inject({
  method: 'POST', url: `/api/threads/${threadId}/chat`, headers: as(),
  payload: { trigger: 'submit-message', message: { id: `m${Date.now()}`, role: 'user', parts } },
})

test('a file uploaded to a chat lands in the agent\'s uploads folder under a safe name', async () => {
  const thread = await newThread('ag_chatrunn')
  const res = await upload({ threadId: thread.id, name: '../../.env', body: Buffer.from('KEY=1') })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { object: 'file', name: 'env', path: '/opt/data/home/uploads/env', size: 5, mediaType: 'text/plain' })
  assert.equal(saveUpload.mock.calls.at(-1)?.arguments[0].id, 'ag_chatrunn')
  assert.equal((await upload({ threadId: thread.id, name: 'a.txt', body: Buffer.from('x'), headers: { authorization: 'Bearer wrong' } })).statusCode, 401)
  assert.equal((await upload({ threadId: thread.id, name: 'a.txt', body: Buffer.alloc(0) })).statusCode, 400)
  assert.equal((await upload({ threadId: thread.id, name: 'big.txt', body: Buffer.alloc((25 << 20) + 1) })).statusCode, 413)
})

test('file names keep only their last segment, lose hidden dots and odd characters, and stay short', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('C:\\Users\\me\\Q3 report.pdf'), 'Q3 report.pdf')
  assert.equal(safeFileName('.bashrc'), 'bashrc')
  assert.equal(safeFileName('notes;rm -rf $HOME.txt'), 'notes-rm -rf -HOME.txt')
  assert.equal(safeFileName('Résumé.pdf'), 'Résumé.pdf')
  assert.equal(safeFileName('...'), 'file')
  assert.equal(safeFileName(')final.txt'), 'final.txt')
  const cjk = safeFileName(`${'報'.repeat(119)}.pdf`)
  assert.ok(Buffer.byteLength(cjk) <= 255, `${Buffer.byteLength(cjk)} bytes`)
  assert.ok(cjk.endsWith('報.pdf'))
  for (const name of [')final.txt', '+-x', '~notes', '...', '  .x', '😀.png', 'a'.repeat(400), `${'é'.repeat(200)}.tar.gz`, 'ë̈.txt', '-', '日本語のファイル名.docx', '(1)']) {
    assert.ok(isUploadName(safeFileName(name)), `${name} -> ${safeFileName(name)}`)
  }
  const long = safeFileName(`${'a'.repeat(300)}.xlsx`)
  assert.equal(long.length, 120)
  assert.ok(long.endsWith('.xlsx'))
})

test('a message with files names their paths to the agent and sends images inline', async () => {
  const thread = await newThread('ag_chatrunn')
  const text = (await upload({ threadId: thread.id, name: 'notes.txt', body: Buffer.from('hello') })).json()
  const image = (await upload({ threadId: thread.id, name: 'chart.png', body: PNG })).json()
  const res = await sendParts({ threadId: thread.id, parts: [
    { type: 'file', mediaType: text.mediaType, filename: text.name, url: text.path },
    { type: 'file', mediaType: image.mediaType, filename: image.name, url: image.path },
    { type: 'text', text: 'What is in these?' },
  ] })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(seen.body?.messages.slice(1), [{ role: 'user', content: [
    { type: 'text', text: 'What is in these?\n\nAttached files:\n- /opt/data/home/uploads/notes.txt (text/plain)\n- /opt/data/home/uploads/chart.png (image/png)' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } },
  ] }])
  const kept = (await app.inject({ method: 'GET', url: `/api/threads/${thread.id}`, headers: as() })).json()
  assert.deepEqual(kept.messages.at(-2).parts.filter((part: { type: string }) => part.type === 'file').map((part: { url: string }) => part.url), [text.path, image.path])
})

test('an image goes inline as the type its bytes say, and bytes that are no image are only named', async () => {
  const thread = await newThread('ag_chatrunn')
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
  const fake = (await upload({ threadId: thread.id, name: 'fake.png', body: Buffer.from('not an image at all') })).json()
  const real = (await upload({ threadId: thread.id, name: 'photo.png', body: jpeg })).json()
  await sendParts({ threadId: thread.id, parts: [
    { type: 'file', mediaType: fake.mediaType, filename: fake.name, url: fake.path },
    { type: 'file', mediaType: real.mediaType, filename: real.name, url: real.path },
    { type: 'text', text: 'Look' },
  ] })
  const content = seen.body?.messages.at(-1)?.content as { type: string; image_url?: { url: string } }[]
  assert.deepEqual(content.filter((part) => part.type === 'image_url').map((part) => part.image_url?.url), [`data:image/jpeg;base64,${jpeg.toString('base64')}`])
  assert.equal(imageTypeOf(Buffer.from('GIF89a')), 'image/gif')
  assert.equal(imageTypeOf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp')
  assert.equal(imageTypeOf(Buffer.from('RIFF\0\0\0\0WAVE', 'latin1')), undefined)
})

test('a file part that points outside the uploads folder is refused', async () => {
  const thread = await newThread('ag_chatrunn')
  for (const url of ['/opt/data/.env', '/opt/data/home/uploads/../../.env', '/opt/data/home/uploads/a/b.txt', 'https://example.com/x.png']) {
    const res = await sendParts({ threadId: thread.id, parts: [{ type: 'file', mediaType: 'text/plain', url }, { type: 'text', text: 'read this' }] })
    assert.equal(res.statusCode, 400, url)
  }
})

test('a file the agent made in its home downloads as an attachment; anything outside its home is refused', async () => {
  const thread = await newThread('ag_chatrunn')
  saved.set('report.csv', Buffer.from('a,b\n1,2\n'))
  const res = await app.inject({ method: 'GET', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent('~/report.csv')}`, headers: as() })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-disposition'], 'attachment; filename*=UTF-8\'\'report.csv')
  assert.equal(res.body, 'a,b\n1,2\n')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  const gone = await app.inject({ method: 'GET', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent('~/gone.csv')}`, headers: as() })
  assert.equal(gone.statusCode, 404)
  assert.equal(gone.json().error.message, 'That file isn\'t in the agent\'s home folder. It may have been moved or deleted.')
  for (const path of ['/opt/data/.env', '/opt/data/home/../.env', '/etc/passwd', '~/../config.yaml']) {
    const refused = await app.inject({ method: 'GET', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent(path)}`, headers: as() })
    assert.equal(refused.statusCode, 400, path)
  }
})

test('a model that can\'t sign in ends the turn with a plain sentence, not the provider\'s dump', async () => {
  const thread = await newThread('ag_chatrunn')
  const res = await say(thread.id, 'model down')
  const error = res.body.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6))).find((chunk) => chunk.type === 'error')
  assert.equal(error.errorText, 'Runner isn\'t ready: its Claude seat isn\'t signed in. An owner or admin connects the seat in Admin, then try again.')
})

test('an agent that isn\'t answering ends the turn with a sentence, not a hang', async () => {
  await new Promise((resolve) => hermes.close(resolve))
  const thread = await newThread('ag_chatrunn')
  const res = await say(thread.id, 'hi')
  const error = res.body.split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6))).find((chunk) => chunk.type === 'error')
  assert.match(error.errorText, /^Runner isn't reachable\. Hermes isn't answering on port 8642 \(ECONNREFUSED\)\.$/)
})

test('removing a chip deletes that upload from the agent\'s uploads folder, and nothing else can be deleted that way', async () => {
  const thread = await newThread('ag_chatrunn')
  const file = (await upload({ threadId: thread.id, name: 'draft.txt', body: Buffer.from('x') })).json()
  const res = await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent(file.path)}`, headers: as() })
  assert.deepEqual(res.json(), { id: '/opt/data/home/uploads/draft.txt', object: 'file', deleted: true })
  assert.deepEqual(removeUploads.mock.calls.at(-1)?.arguments[0], { id: 'ag_chatrunn', names: ['draft.txt'] })
  assert.equal(saved.has('uploads/draft.txt'), false)
  const calls = removeUploads.mock.callCount()
  for (const path of ['/opt/data/home/report.csv', '/opt/data/home/uploads/../.env', '/opt/data/home/uploads/a/b.txt', '/opt/data/.env']) {
    const refused = await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent(path)}`, headers: as() })
    assert.equal(refused.statusCode, 400, path)
  }
  assert.equal(removeUploads.mock.callCount(), calls)
})

test('a lookup reports only the mentioned files that exist in the agent\'s home', async () => {
  const thread = await newThread('ag_chatrunn')
  saved.set('out/summary.md', Buffer.from('# Summary'))
  const res = await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/files/lookups`, headers: as(), payload: { paths: ['~/out/summary.md', '/opt/data/home/out/summary.md', '/opt/data/home/nope.txt', '/etc/passwd', '~/../.env'] } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().data, [
    { object: 'file', name: 'summary.md', path: '~/out/summary.md', size: 9 },
    { object: 'file', name: 'summary.md', path: '/opt/data/home/out/summary.md', size: 9 },
  ])
})

test('a path too deep to be in the home is dropped from a lookup instead of hiding every other file', async () => {
  const thread = await newThread('ag_chatrunn')
  saved.set('report.csv', Buffer.from('a'))
  const deep = `~/${Array.from({ length: 40 }, (_, index) => `d${index}`).join('/')}/x.txt`
  const res = await app.inject({ method: 'POST', url: `/api/threads/${thread.id}/files/lookups`, headers: as(), payload: { paths: ['~/report.csv', deep] } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().data.map((file: { path: string }) => file.path), ['~/report.csv'])
  assert.equal((await app.inject({ method: 'GET', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent(deep)}`, headers: as() })).statusCode, 400)
})

test('deleting an upload that isn\'t there answers 404, not deleted', async () => {
  const thread = await newThread('ag_chatrunn')
  const res = await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}/files?path=${encodeURIComponent('/opt/data/home/uploads/never.txt')}`, headers: as() })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error.message, 'That upload isn\'t in the agent\'s uploads folder. It may have been deleted already.')
})

test('clearing a chat also deletes the uploads still waiting in the composer, and only uploads', async () => {
  const thread = await newThread('ag_chatrunn')
  const waiting = (await upload({ threadId: thread.id, name: 'waiting.txt', body: Buffer.from('x') })).json()
  saved.set('report.csv', Buffer.from('a'))
  const res = await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}`, headers: as(), payload: { uploads: [waiting.path, '/opt/data/home/report.csv', '/opt/data/home/uploads/../.env'] } })
  assert.equal(res.statusCode, 200)
  const names: string[] = removeUploads.mock.calls.at(-1)?.arguments[0].names ?? []
  assert.ok(names.includes('waiting.txt'))
  assert.ok(names.every((name) => !name.includes('/') && name !== 'report.csv' && name !== '.env'))
  assert.equal(saved.has('uploads/waiting.txt'), false)
  assert.equal(saved.has('report.csv'), true)
})

test('clearing a chat deletes the files uploaded to it from the agent\'s home, and nothing else', async () => {
  const thread = await newThread('ag_chatrunn')
  const kept = (await upload({ threadId: thread.id, name: 'other.txt', body: Buffer.from('x') })).json()
  const sent = (await upload({ threadId: thread.id, name: 'sent.txt', body: Buffer.from('x') })).json()
  await sendParts({ threadId: thread.id, parts: [{ type: 'file', mediaType: 'text/plain', filename: sent.name, url: sent.path }, { type: 'text', text: 'read it' }] })
  saved.set('report.csv', Buffer.from('a'))
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}`, headers: as() })).statusCode, 200)
  assert.deepEqual(removeUploads.mock.calls.at(-1)?.arguments[0].names.includes('sent.txt'), true)
  assert.equal(saved.has('uploads/sent.txt'), false)
  assert.equal(saved.has(`uploads/${kept.name}`), true)
  assert.equal(saved.has('report.csv'), true)
})

test('clearing a chat deletes it, and the next one is a new thread with a new Hermes session', async () => {
  const thread = await newThread('ag_chatrunn')
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/threads/${thread.id}`, headers: as() })).statusCode, 200)
  const fresh = await newThread('ag_chatrunn')
  assert.notEqual(fresh.id, thread.id)
  assert.equal((await app.inject({ method: 'GET', url: `/api/threads/${fresh.id}`, headers: as() })).json().messages.length, 0)
})

test('the agent\'s own model and channel calls through the broker are not shown as tools', () => {
  assert.equal(shownCall('anthropic POST /v1/messages'), false)
  assert.equal(shownCall('codex POST /responses'), false)
  assert.equal(shownCall('telegram POST /bot…/sendMessage'), false)
  assert.equal(shownCall('postgres_query'), true)
  assert.equal(shownCall('github_create_pull_request'), true)
})
