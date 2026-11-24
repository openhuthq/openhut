// M5, packaged: one shell, N−1 (the packs inside it) → N by pack, with no electron-updater. Builds N's packs from this checkout's dist
// with scripts/pack.ts (its renderer marked), signs them with a throwaway test key, logs them in a stand-in Rekor, serves the R4 feed,
// and drives the app over CDP through Settings › Updates: waiting for the safety check, refused, ready, details, the swap, halted.
// Screenshots go to --out. Linux (xvfb) for now: node scripts/pack-update-test.mjs --app release/linux-unpacked/openhut --out <dir> [--cloud ../../private/api]
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { bootCloud, devCloudUrl, signIn } from './dev-cloud.mjs'
import { fakeRekor } from '../test/fake-rekor.ts'

const { values: args } = parseArgs({ options: { app: { type: 'string' }, out: { type: 'string', default: 'pack-update' }, cloud: { type: 'string' } } })
if (!args.app) {
  console.error('usage: node scripts/pack-update-test.mjs --app <packaged OpenHut executable> [--out <dir>] [--cloud <private/api>]')
  process.exit(2)
}
const repo = join(import.meta.dirname, '../../..')
const dist = join(import.meta.dirname, '../dist')
const root = mkdtempSync(join(tmpdir(), 'openhut-pack-update-'))
const out = resolve(args.out)
mkdirSync(out, { recursive: true })
const home = join(root, 'home')
const feedDir = join(root, 'feed')
const packs = join(root, 'packs')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const say = (step, detail) => console.log(`pack-update-test: ${step}${detail ? ` ${JSON.stringify(detail)}` : ''}`)
const node = (script, argv, env = {}) => execFileSync(process.execPath, [join(repo, 'scripts', script), ...argv], { encoding: 'utf8', env: { ...process.env, ...env } }).trim()

let clock = Math.floor(Date.now() / 1000)
const { rekorKey, server: rekor } = fakeRekor(() => clock)
await new Promise((done) => rekor.listen(0, '127.0.0.1', done))
const rekorUrl = `http://127.0.0.1:${rekor.address().port}`
const feed = createServer((req, res) => {
  const file = join(feedDir, decodeURIComponent(new URL(req.url, 'http://feed').pathname))
  if (!existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200).end(readFileSync(file))
}).listen(0, '127.0.0.1')
await new Promise((done) => feed.once('listening', done))
mkdirSync(join(feedDir, 'packs'), { recursive: true })
mkdirSync(join(feedDir, 'channels/stable'), { recursive: true })
// electron-updater still asks for a new shell; an older version means none.
writeFileSync(join(feedDir, 'latest-linux.yml'), 'version: 0.0.1\nfiles: []\npath: none\nsha512: none\n')
const keyFile = join(root, 'test-release.pem')
const testKey = node('release-key.ts', ['key', keyFile])
const API = devCloudUrl()
const env = { ...process.env, ...args.cloud && { OPENHUT_API_URL: API, OPENHUT_CLOUD_URL: API }, OPENHUT_TEST_HOME: home, OPENHUT_SECOND_APP: '1', OPENHUT_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/`, OPENHUT_MODEL: 'test', OPENHUT_SANDBOX: 'memory', OPENHUT_RELEASE_KEY: testKey, OPENHUT_REKOR_KEY: rekorKey }

const publish = ({ logged = true } = {}) => {
  for (const name of readdirSync(packs).filter((each) => each.startsWith('openhut-'))) copyFileSync(join(packs, name), join(feedDir, 'packs', createHash('sha512').update(readFileSync(join(packs, name))).digest('hex')))
  for (const ext of ['', '.sig', '.rekor']) copyFileSync(join(packs, `release.json${ext}`), join(feedDir, `channels/stable/release.json${ext}`))
  if (!logged) rmSync(join(feedDir, 'channels/stable/release.json.rekor'))
}
const sign = (sequence) => node('release-key.ts', ['sign', keyFile, packs, '9.9.9', '--channel', 'stable', '--sequence', String(sequence), '--rekor', rekorUrl])

let child
let api
try {
  // N: this dist, its renderer marked so the swap is visible, packed by scripts/pack.ts.
  const index = join(dist, 'renderer/index.html')
  const original = readFileSync(index, 'utf8')
  writeFileSync(index, original.replace('<head>', '<head><meta name="openhut-pack" content="N">'))
  try {
    node('pack.ts', [packs])
  } finally {
    writeFileSync(index, original)
  }
  sign(100)
  publish()
  say('N\'s packs are signed and logged just now (sequence 100)')

  if (args.cloud) api = await bootCloud({ dir: args.cloud, api: API })
  child = launch()
  let page = await connect()
  await until(async () => (await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)"))?.server?.healthy, 90, 'the runtime')
  if (args.cloud) await signIn({ page, api: API })
  const before = await page.eval('window.openhut.version')
  say('N−1 (the packs inside the shell) is running', { version: before })

  const state = (want) => until(async () => {
    const now = await page.eval('window.openhut.update.check()')
    return want(now) ? now : null
  }, 120, 'the update state')
  await say('waiting', await state((now) => now.waiting))
  await shot(page, 'm5-1-waiting')

  publish({ logged: false })
  say('refused', await state((now) => now.refused))
  await shot(page, 'm5-4-refused')

  clock -= 2 * 3600
  sign(101)
  clock += 2 * 3600
  publish()
  say('ready', await state((now) => now.ready?.pack))
  await shot(page, 'm5-2-ready')
  await page.eval("location.reload(), true").catch(() => undefined)
  await sleep(4000)
  await page.eval("document.querySelector('details').open = true")
  await shot(page, 'm5-3-details')

  const exited = new Promise((done) => child.once('exit', done))
  await page.eval('window.openhut.update.install()').catch(() => undefined)
  await Promise.race([exited, sleep(60_000).then(() => { throw new Error('the app didn\'t quit within a minute') })])
  say('pressed Restart to update; the app quit')
  child = launch()
  page = await connect()
  await until(async () => (await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)"))?.server?.healthy, 90, 'the runtime on N')
  const after = { version: await page.eval('window.openhut.version'), marker: await page.eval("document.querySelector('meta[name=openhut-pack]')?.content ?? null"), state: JSON.parse(readFileSync(join(home, 'packs/state.json'), 'utf8')) }
  say('relaunched', after)
  if (after.version !== '9.9.9' || after.marker !== 'N' || after.state.current?.sequence !== 101 || after.state.pending) throw new Error('the app isn\'t running N\'s packs')
  if (existsSync(join(home, 'logs/updates.log')) && /download-progress|downloadUpdate/.test(readFileSync(join(home, 'logs/updates.log'), 'utf8'))) throw new Error('electron-updater downloaded something')

  node('release-key.ts', ['point', keyFile, packs, join(root, 'halt'), '--halt', '--sequence', '102', '--rekor', rekorUrl])
  for (const ext of ['', '.sig', '.rekor']) copyFileSync(join(root, 'halt', `release.json${ext}`), join(feedDir, `channels/stable/release.json${ext}`))
  say('halted', await state((now) => now.halted))
  await shot(page, 'm5-5-halted')
  console.log('pack-update-test: PASS')
} catch (error) {
  console.error(`pack-update-test: FAIL ${error.stack ?? error}`)
  process.exitCode = 1
  if (existsSync(join(home, 'logs'))) for (const name of readdirSync(join(home, 'logs'))) copyFileSync(join(home, 'logs', name), join(out, name))
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  api?.kill()
  feed.closeAllConnections()
  feed.close()
  rekor.close()
}

function launch() {
  const proc = spawn(args.app, [`--remote-debugging-port=${cdpPort}`, '--no-sandbox', '--password-store=basic'], { env, stdio: 'ignore' })
  proc.on('exit', (code, signal) => say('app process exited', { code, signal }))
  return proc
}

async function shot(page, name) {
  if (!await page.eval("location.pathname === '/settings/updates'")) {
    await page.eval("setTimeout(() => location.assign('/settings/updates'), 10), true")
    await sleep(4000)
  }
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'))
  say('screenshot', { name })
}

async function connect() {
  const target = await until(async () => {
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json()).catch(() => [])
    return list.find((each) => each.type === 'page' && each.url.startsWith('app://openhut'))
  }, 90, 'the app window')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail })
  const waiting = new Map()
  let id = 0
  socket.onmessage = (message) => {
    const reply = JSON.parse(message.data)
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  }
  const send = (method, params) => new Promise((done, fail) => {
    const n = ++id
    waiting.set(n, (reply) => reply.error ? fail(new Error(reply.error.message)) : done(reply.result))
    socket.send(JSON.stringify({ id: n, method, params }))
    setTimeout(() => waiting.has(n) && (waiting.delete(n), fail(new Error(`no answer to ${method}`))), 30_000)
  })
  return {
    send,
    eval: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error')
      return result.result?.value
    },
  }
}

async function until(check, seconds, what) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1000)) {
    const value = await check().catch(() => null)
    if (value) return value
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`)
}
