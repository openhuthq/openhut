import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { bootCloud, devCloudUrl, signIn } from './dev-cloud.mjs'
import { RELEASE_KEY } from '../src/release-key.mjs'

const { values: args } = parseArgs({ options: { from: { type: 'string' }, feed: { type: 'string' }, via: { type: 'string', default: 'button' }, keep: { type: 'boolean', default: false }, broken: { type: 'boolean', default: false }, cloud: { type: 'string' } } })
const LINUX = process.platform === 'linux'
const YML = LINUX ? 'latest-linux.yml' : 'latest-mac.yml'
if (!args.from || !args.feed || !['button', 'quit'].includes(args.via) || (LINUX && args.broken)) {
  console.error('usage: node scripts/update-test.mjs --from <old OpenHut.app or OpenHut-x64.AppImage> --feed <folder or URL with latest-mac.yml and the new zip, or latest-linux.yml and the new AppImage> [--via button|quit] [--broken (Mac only)] [--keep] [--cloud <private/api>]')
  process.exit(2)
}
const remote = /^https?:\/\//.test(args.feed)
const yml = remote ? await (await fetch(new URL(YML, args.feed))).text() : readFileSync(join(args.feed, YML), 'utf8')
const want = /^version: (.+)$/m.exec(yml)[1].trim()
const missing = remote ? [] : [...yml.matchAll(/^\s*-?\s*(?:url|path): (.+)$/gm)].map((match) => match[1].trim()).filter((name) => !existsSync(join(args.feed, name)))
if (missing.length) {
  console.error(`update-test: ${args.feed} lacks ${[...new Set(missing)].join(', ')}, which its ${YML} names, so the signed release.json wouldn't cover them and the app would refuse the update`)
  process.exit(2)
}
const root = mkdtempSync(join(tmpdir(), 'openhut-update-'))
const app = join(root, LINUX ? 'OpenHut.AppImage' : 'Applications/OpenHut.app')
const newSha = /url: \S+\.AppImage\s+sha512: (\S+)/.exec(yml)?.[1]
const home = join(root, 'home')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const evidence = { via: args.via, want, broken: args.broken, steps: [], waits: [] }
const say = (step, detail = {}) => {
  evidence.steps.push({ step, ...detail, at: new Date().toISOString() })
  console.log(`update-test: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

if (LINUX) {
  copyFileSync(args.from, app)
  chmodSync(app, 0o755)
} else execFileSync('ditto', [args.from, app])
const feed = createServer((req, res) => {
  const file = join(args.feed, basename(decodeURIComponent(new URL(req.url, 'http://feed').pathname)))
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-length': statSync(file).size })
  createReadStream(file).pipe(res)
}).listen(0, '127.0.0.1')
await new Promise((resolve) => feed.once('listening', resolve))
const releaseScript = join(import.meta.dirname, '../../../scripts/release.sh')
const testKey = RELEASE_KEY && !remote ? execFileSync(releaseScript, ['key', join(root, 'test-release.pem')], { encoding: 'utf8' }).trim() : ''
if (testKey) execFileSync(releaseScript, ['sign', resolve(args.feed)], { env: { ...process.env, RELEASE_KEY: join(root, 'test-release.pem') } })
const API = devCloudUrl()
const env = { ...process.env, ...args.cloud && { OPENHUT_API_URL: API, OPENHUT_CLOUD_URL: API }, OPENHUT_TEST_HOME: home, OPENHUT_SECOND_APP: '1', OPENHUT_UPDATE_FEED: remote ? args.feed : `http://127.0.0.1:${feed.address().port}/`, OPENHUT_MODEL: 'test', OPENHUT_SANDBOX: 'memory', ...testKey && { OPENHUT_RELEASE_KEY: testKey } }

let child
let api
try {
  if (args.cloud) api = await bootCloud({ dir: args.cloud, api: API })
  say('installed the old app', { version: onDisk(), signature: signedBy() })
  child = launch()
  let page = await connect()
  const admin = await until(async () => {
    const reply = await adminOf(page)
    return reply?.server?.healthy ? reply : null
  }, 60, 'the old app\'s runtime to be healthy')
  say('the old app is running', { version: await page.eval('window.openhut.version'), runtimeBuild: admin.server.build })
  if (args.cloud) {
    await signIn({ page, api: API })
    say('signed in to the dev cloud as mo@example.com and saved the kit')
  }
  const agent = await page.eval("fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Keepme' }) }).then(async (r) => ({ status: r.status, ...await r.json() }))")
  if (!agent.id) throw new Error(`making the agent to keep answered ${agent.status} ${JSON.stringify(agent.error ?? agent)}`)
  say('made an agent to check the data survives', { id: agent.id })
  const ready = await until(async () => {
    const state = await page.eval('window.openhut.update.state()')
    if (state.error) throw new Error(`the update failed with "${state.error}"; see ${home}/logs/updates.log`)
    return state.ready ? state : null
  }, 300, 'the updater to download and verify the new version')
  say('the updater verified the new version and the app shows it ready', ready)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  if (args.via === 'button') await page.eval('window.openhut.update.install()').catch(() => undefined)
  else child.kill('SIGTERM')
  await Promise.race([exited, sleep(60_000).then(() => { throw new Error('the old app didn\'t quit within a minute') })])
  child = undefined
  say(args.via === 'button' ? 'pressed Restart to update; the app quit' : 'quit the app')
  await until(async () => onDisk() === want, 120, `the app on disk to become ${want}`)
  if (!LINUX) execFileSync('codesign', ['--verify', '--deep', '--strict', app])
  say('the app on disk is the new version and its signature verifies', { version: onDisk(), signature: signedBy() })
  if (args.broken) {
    const old = plistVersion.call(null, args.from)
    child = launch({ OPENHUT_TEST_DIALOG: 'Go back' })
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(180_000).then(() => { throw new Error('the broken version didn\'t give up within 3 minutes') })])
    child = undefined
    say('the new version couldn\'t start, so it picked Go back and quit')
    await until(async () => plistVersion() === old, 120, `the bundle on disk to be ${old} again`)
    execFileSync('codesign', ['--verify', '--deep', '--strict', app])
    say('the bundle on disk is the old version again and its signature verifies', { version: plistVersion(), signature: signedBy() })
    evidence.want = old
  }
  const expected = evidence.want
  child = launch()
  page = await connect()
  const after = await until(async () => {
    const reply = await adminOf(page)
    return reply?.server?.healthy ? reply : null
  }, 60, 'the new app\'s runtime to be healthy')
  const agents = await page.eval("fetch('/api/agents').then((r) => r.json())")
  const version = await page.eval('window.openhut.version')
  const kept = agents.data.some((each) => each.id === agent.id)
  say('relaunched', { version, runtimeBuild: after.server.build, healthy: after.server.healthy, agentKept: kept })
  if (version !== expected || !kept) throw new Error(`expected version ${expected} with the agent kept, got ${version}, kept=${kept}`)
  if (args.broken) {
    const state = await until(async () => {
      const now = await page.eval('window.openhut.update.check()')
      return now.checking ? null : now
    }, 60, 'a fresh update check')
    say('the old version checked again and doesn\'t offer the broken one', { available: state.available, ready: state.ready })
    if (state.available || state.ready) throw new Error(`the old version offered ${state.available ?? state.ready?.version} again`)
  }
  evidence.pass = true
  console.log(`update-test: PASS ${JSON.stringify(evidence)}`)
} catch (error) {
  evidence.pass = false
  evidence.error = error.message
  console.error(`update-test: FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(15_000)])
  }
  api?.kill()
  feed.close()
  if (!args.keep) rmSync(root, { recursive: true, force: true })
  else console.log(`update-test: kept ${root}`)
}

function launch(extra = {}) {
  const proc = LINUX
    ? spawn(app, [`--remote-debugging-port=${cdpPort}`, '--no-sandbox', '--password-store=basic'], { env: { ...env, ...extra }, stdio: 'ignore' })
    : spawn(join(app, 'Contents/MacOS/OpenHut'), [`--remote-debugging-port=${cdpPort}`], { env: { ...env, ...extra }, stdio: 'ignore' })
  proc.on('exit', (code, signal) => say('app process exited', { code, signal }))
  return proc
}

async function connect() {
  const target = await until(async () => {
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json()).catch(() => [])
    return list.find((each) => each.type === 'page' && each.url.startsWith('app://openhut'))
  }, 60, 'the app window')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const waiting = new Map()
  let id = 0
  socket.onmessage = (message) => {
    const reply = JSON.parse(message.data)
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  }
  return {
    eval: (expression) => new Promise((resolve, reject) => {
      const n = ++id
      waiting.set(n, (reply) => reply.result?.exceptionDetails ? reject(new Error(reply.result.exceptionDetails.exception?.description ?? 'page error')) : resolve(reply.result?.result?.value))
      socket.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => waiting.has(n) && (waiting.delete(n), reject(new Error(`no answer to ${expression}`))), 30_000)
    }),
  }
}

async function adminOf(page) {
  const reply = await page.eval("fetch('/api/admin').then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : await r.text() }), () => null)")
  if (reply?.status === 401 || reply?.status === 403) throw new Error(`GET /api/admin answered ${reply.status}, which waiting won't change: ${String(reply.body).slice(0, 300)}`)
  return reply?.status === 200 ? reply.body : null
}

async function until(check, seconds, what) {
  const started = Date.now()
  const waited = (outcome) => evidence.waits.push({ what, seconds: Math.round((Date.now() - started) / 1000), limit: seconds, outcome })
  for (const end = started + seconds * 1000; Date.now() < end; await sleep(1000)) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      waited('app exited')
      throw new Error(`the app exited (${child.exitCode ?? child.signalCode}) while waiting for ${what}`)
    }
    const value = await check().catch((error) => {
      waited('failed')
      throw error
    })
    if (value) {
      waited('done')
      return value
    }
  }
  waited('timed out')
  throw new Error(`timed out after ${seconds}s waiting for ${what}`)
}

function plistVersion(bundle = app) {
  const read = spawnSync('defaults', ['read', join(bundle, 'Contents/Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' })
  return read.status === 0 ? read.stdout.trim() : ''
}

function onDisk() {
  if (!LINUX) return plistVersion()
  return createHash('sha512').update(readFileSync(app)).digest('base64') === newSha ? want : 'the old version'
}

function signedBy() {
  if (LINUX) return 'unsigned (AppImage)'
  return /TeamIdentifier=(\S+)/.exec(spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr)?.[1] ?? 'none'
}
