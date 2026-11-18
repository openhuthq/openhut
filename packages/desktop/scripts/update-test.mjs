import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { from: { type: 'string' }, feed: { type: 'string' }, via: { type: 'string', default: 'button' }, keep: { type: 'boolean', default: false }, broken: { type: 'boolean', default: false } } })
if (!args.from || !args.feed || !['button', 'quit'].includes(args.via)) {
  console.error('usage: node scripts/update-test.mjs --from <old OpenHut.app> --feed <folder or URL with latest-mac.yml and the new zip> [--via button|quit] [--broken] [--keep]')
  process.exit(2)
}
const remote = /^https?:\/\//.test(args.feed)
const want = /^version: (.+)$/m.exec(remote ? await (await fetch(new URL('latest-mac.yml', args.feed))).text() : readFileSync(join(args.feed, 'latest-mac.yml'), 'utf8'))[1].trim()
const root = mkdtempSync(join(tmpdir(), 'openhut-update-'))
const app = join(root, 'Applications/OpenHut.app')
const home = join(root, 'home')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const evidence = { via: args.via, want, broken: args.broken, steps: [] }
const say = (step, detail = {}) => {
  evidence.steps.push({ step, ...detail, at: new Date().toISOString() })
  console.log(`update-test: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

execFileSync('ditto', [args.from, app])
const feed = createServer((req, res) => {
  const file = join(args.feed, basename(decodeURIComponent(new URL(req.url, 'http://feed').pathname)))
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-length': statSync(file).size })
  createReadStream(file).pipe(res)
}).listen(0, '127.0.0.1')
await new Promise((resolve) => feed.once('listening', resolve))
const env = { ...process.env, OPENHUT_TEST_HOME: home, OPENHUT_UPDATE_FEED: remote ? args.feed : `http://127.0.0.1:${feed.address().port}/`, OPENHUT_MODEL: 'test', OPENHUT_SANDBOX: 'memory' }

let child
try {
  say('installed the old app', { version: plistVersion(), signature: signedBy() })
  child = launch()
  let page = await connect()
  const admin = await until(async () => {
    const reply = await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)")
    return reply?.server?.healthy ? reply : null
  }, 120, 'the old app\'s runtime to be healthy')
  say('the old app is running', { version: await page.eval('window.openhut.version'), runtimeBuild: admin.server.build })
  const agent = await page.eval("fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Keepme' }) }).then((r) => r.json())")
  say('made an agent to check the data survives', { id: agent.id })
  const ready = await until(async () => {
    const state = await page.eval('window.openhut.update.state()')
    if (state.error) throw new Error(`the update failed with "${state.error}"; see ${home}/logs/updates.log`)
    return state.ready ? state : null
  }, 600, 'Squirrel to verify the new version')
  say('Squirrel verified the new version and the app shows it ready', ready)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  if (args.via === 'button') await page.eval('window.openhut.update.install()').catch(() => undefined)
  else child.kill('SIGTERM')
  await Promise.race([exited, sleep(60_000).then(() => { throw new Error('the old app didn\'t quit within a minute') })])
  say(args.via === 'button' ? 'pressed Restart to update; the app quit' : 'quit the app')
  await until(async () => plistVersion() === want, 180, `the bundle on disk to become ${want}`)
  execFileSync('codesign', ['--verify', '--deep', '--strict', app])
  say('the bundle on disk is the new version and its signature verifies', { version: plistVersion(), signature: signedBy() })
  if (args.broken) {
    const old = plistVersion.call(null, args.from)
    child = launch({ OPENHUT_TEST_DIALOG: 'Go back' })
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(180_000).then(() => { throw new Error('the broken version didn\'t give up within 3 minutes') })])
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
    const reply = await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)")
    return reply?.server?.healthy ? reply : null
  }, 120, 'the new app\'s runtime to be healthy')
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
  feed.close()
  if (!args.keep) rmSync(root, { recursive: true, force: true })
  else console.log(`update-test: kept ${root}`)
}

function launch(extra = {}) {
  const proc = spawn(join(app, 'Contents/MacOS/OpenHut'), [`--remote-debugging-port=${cdpPort}`], { env: { ...env, ...extra }, stdio: 'ignore' })
  proc.on('exit', (code, signal) => say('app process exited', { code, signal }))
  return proc
}

async function connect() {
  const target = await until(async () => {
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json()).catch(() => [])
    return list.find((each) => each.type === 'page' && each.url.startsWith('app://openhut'))
  }, 120, 'the app window')
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

async function until(check, seconds, what) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1000)) {
    const value = await check()
    if (value) return value
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`)
}

function plistVersion(bundle = app) {
  const read = spawnSync('defaults', ['read', join(bundle, 'Contents/Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' })
  return read.status === 0 ? read.stdout.trim() : ''
}

function signedBy() {
  return /TeamIdentifier=(\S+)/.exec(spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr)?.[1] ?? 'none'
}
