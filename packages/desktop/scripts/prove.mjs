import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import pngjs from 'pngjs'
import { attach } from './cdp.mjs'
import { bootCloud, bootWorker } from './dev-cloud.mjs'

const { values: args } = parseArgs({ options: { flows: { type: 'string', default: 'onboarding' }, out: { type: 'string' }, cloud: { type: 'string', default: '../../private/api' }, keep: { type: 'boolean', default: false } } })
const DESKTOP = resolve(import.meta.dirname, '..')
const ROOT = resolve(DESKTOP, '../..')
const BACKEND = join(DESKTOP, 'dist/backend')
const out = resolve(args.out ?? join(DESKTOP, 'prove', args.flows))
const previous = `${out}-previous`
const work = join(tmpdir(), `openhut-prove-${process.pid}`)
const started = Date.now()
const children = []
const manifest = { flows: args.flows, platform: process.platform, startedAt: new Date(started).toISOString(), screens: [], steps: [] }

if (!existsSync(join(BACKEND, 'runtime'))) {
  console.error('prove runs real agents, which need the packed backend: npm -w @openhut/desktop run pack-backend (needs uv)')
  process.exit(2)
}
if (existsSync(out)) {
  rmSync(previous, { recursive: true, force: true })
  renameSync(out, previous)
}
mkdirSync(out, { recursive: true })
mkdirSync(work, { recursive: true })

const say = (step, detail = {}) => {
  manifest.steps.push({ step, ...detail, seconds: Math.round((Date.now() - started) / 100) / 10 })
  console.log(`prove: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

async function until(check, seconds, what) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(250)) {
    const value = await check().catch(() => null)
    if (value) return value
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`)
}

async function freePort() {
  return new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function child(command, argv, options) {
  const proc = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  children.push(proc)
  return proc
}

function logTo(proc, name) {
  const file = join(work, `${name}.log`)
  const lines = []
  for (const stream of [proc.stdout, proc.stderr]) stream?.on('data', (chunk) => lines.push(String(chunk)))
  proc.on('exit', () => writeFileSync(file, lines.join('')))
  return () => lines.join('')
}

function chromePath() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const found = [process.env.CHROME_PATH, ...candidates].find((each) => each && existsSync(each))
  if (!found) throw new Error('prove needs Google Chrome or Chromium; set CHROME_PATH')
  return found
}

async function browser() {
  const port = await freePort()
  child(chromePath(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, 'chrome')}`, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--window-size=1280,860', '--hide-scrollbars', 'about:blank'])
  await until(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok), 30, 'headless Chrome')
  return {
    async tab(url) {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json()
      const page = await attach(target.webSocketDebuggerUrl)
      await page.send('Page.enable', {})
      await page.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => undefined)
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
      return page
    },
  }
}

const api = { url: `http://127.0.0.1:${await freePort()}` }
const cloud = { url: `http://127.0.0.1:${await freePort()}` }
let chrome
const windows = []

async function runtime(name, { personal = true, env = {} } = {}) {
  const port = await freePort()
  const data = join(work, name)
  mkdirSync(data, { recursive: true })
  const server = child(process.execPath, [join(ROOT, 'packages/runtime/src/server/app.ts')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port), OPENHUT_GATEWAY_PORT: String(await freePort()), OPENHUT_DATA: join(data, 'app'), AGENTD_DATA: data,
      AGENTD_HERMES: join(BACKEND, 'runtime'), OPENHUT_BIN: join(BACKEND, 'bin/native'), OPENHUT_SANDBOX: 'native', OPENHUT_AGENT_HOST_NET: '1',
      OPENHUT_MODEL: 'test', OPENHUT_CLOUD_URL: cloud.url, OPENHUT_API_URL: api.url, OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('dev').digest('hex'),
      ...personal && { OPENHUT_PERSONAL: '1' }, ...env,
    },
  })
  const log = logTo(server, name)
  const headers = { authorization: 'Bearer dev' }
  await until(() => fetch(`http://127.0.0.1:${port}/api/admin`, { headers }).then((r) => r.ok), 60, `${name}'s runtime`).catch((error) => { throw new Error(`${error.message}\n${log().slice(-2000)}`) })
  const vite = child(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), join(DESKTOP, 'src/renderer'), '--port', String(await freePort()), '--strictPort'], { cwd: ROOT, env: { ...process.env, PORT: String(port), VITE_OPENHUT_DEV: 'Dev · local cloud' } })
  const viteLog = logTo(vite, `${name}-vite`)
  const app = await until(async () => /Local:\s+(http:\/\/\S+)/.exec(viteLog().replace(/\x1b\[[0-9;]*m/g, ''))?.[1]?.replace(/\/$/, ''), 30, `${name}'s renderer`)
  say(`${name}'s runtime is up`, { runtime: `http://127.0.0.1:${port}`, app })
  return { name, port, app, server, log, headers, api: (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...headers, 'content-type': 'application/json', ...init.headers } }) }
}

async function window(rt, path = '/') {
  const page = await chrome.tab(`${rt.app}${path}`)
  page.runtime = rt
  windows.push(page)
  return page
}

async function shot({ page, name, step, settle = 700 }) {
  await sleep(settle)
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  const png = Buffer.from(data, 'base64')
  writeFileSync(join(out, `${name}.png`), png)
  const text = String(await page.eval('document.body?.innerText ?? ""')).replace(/\s+/g, ' ').trim()
  manifest.screens.push({ name, step, runtime: page.runtime?.name, file: `${name}.png`, sha256: createHash('sha256').update(png).digest('hex'), text })
  say(`screen ${name}`, { step })
}

const steady = (text) => text.replace(/\b\d{1,2}:\d{2}(\s?[AP]M)?\b/g, 'H:MM')
const PIXEL_NOISE = 1280 * 860 * 0.005

function pixelsApart(before, after) {
  const a = pngjs.PNG.sync.read(readFileSync(before))
  const b = pngjs.PNG.sync.read(readFileSync(after))
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height
  let apart = 0
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) apart++
  return apart
}

function diffWith() {
  const before = existsSync(join(previous, 'manifest.json')) ? JSON.parse(readFileSync(join(previous, 'manifest.json'), 'utf8')) : null
  if (!before) return null
  const old = new Map(before.screens.map((each) => [each.name, each]))
  const now = new Map(manifest.screens.map((each) => [each.name, each]))
  const changed = []
  for (const screen of manifest.screens) {
    const was = old.get(screen.name)
    if (!was) changed.push({ name: screen.name, how: 'new' })
    else if (was.sha256 !== screen.sha256) {
      const pixels = pixelsApart(join(previous, was.file), join(out, screen.file))
      if (steady(was.text) !== steady(screen.text)) changed.push({ name: screen.name, how: 'text', pixels, textBefore: was.text })
      else if (pixels > PIXEL_NOISE) changed.push({ name: screen.name, how: `${pixels} pixels`, pixels })
    }
  }
  const removed = before.screens.filter((each) => !now.has(each.name)).map((each) => each.name)
  return { against: before.startedAt, changed, removed, same: manifest.screens.length - changed.length }
}

function gallery(diff) {
  const marks = new Map((diff?.changed ?? []).map((each) => [each.name, each.how]))
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const cards = manifest.screens.map((each) => `<figure class="${marks.has(each.name) ? 'changed' : ''}"><a href="${each.file}"><img src="${each.file}" loading="lazy"></a><figcaption><b>${escape(each.name)}</b>${marks.has(each.name) ? ` <i>${escape(marks.get(each.name))}</i>` : ''}<br>${escape(each.step)}${each.runtime ? ` · ${escape(each.runtime)}` : ''}</figcaption></figure>`).join('\n')
  const head = diff ? `${diff.changed.length} changed, ${diff.removed.length} removed, ${diff.same} the same since ${escape(diff.against)}${diff.removed.length ? ` (removed: ${diff.removed.map(escape).join(', ')})` : ''}` : 'No earlier run to compare with.'
  return `<!doctype html><meta charset="utf-8"><title>OpenHut ${escape(manifest.flows)} screens</title>
<style>body{font:14px system-ui;margin:24px;background:#fafafa}figure{display:inline-block;width:400px;margin:8px;vertical-align:top;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}figure.changed{border:3px solid #e8590c}img{width:100%}i{color:#e8590c}label{margin-left:12px}</style>
<h1>${escape(manifest.flows)} on ${escape(manifest.platform)}, ${manifest.seconds}s</h1><p>${head}<label><input type="checkbox" onchange="document.body.classList.toggle('only',this.checked)"> changed only</label></p>
<style>.only figure:not(.changed){display:none}</style>
${cards}`
}

let failed
try {
  say('booting the dev cloud', { api: api.url, cloud: cloud.url })
  const cloudDir = resolve(DESKTOP, args.cloud)
  const [apiProc, workerProc] = await Promise.all([
    bootCloud({ dir: cloudDir, api: api.url, log: join(work, 'cloud-api.log') }),
    bootWorker({ dir: resolve(cloudDir, '../cloud'), url: cloud.url, state: join(work, 'worker-state'), log: join(work, 'cloud-worker.log') }),
    browser().then((made) => { chrome = made }),
  ])
  children.push(apiProc, workerProc)
  const { flows } = await import(`./flows/${args.flows}.mjs`)
  await flows({ runtime, window, shot, say, until, api: api.url })
} catch (error) {
  failed = error
  console.error(`prove: FAIL ${error.stack ?? error.message}`)
  process.exitCode = 1
  for (const page of windows) await shot({ page, name: `zz-failed-${page.runtime.name}`, step: `what ${page.runtime.name}'s window showed when the run failed`, settle: 0 }).catch(() => undefined)
} finally {
  manifest.seconds = Math.round((Date.now() - started) / 1000)
  manifest.error = failed?.message
  const diff = diffWith()
  manifest.diff = diff
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(out, 'index.html'), gallery(diff))
  for (const each of children) each.kill()
  await sleep(500)
  for (const each of readdirSync(work).filter((name) => name.endsWith('.log'))) writeFileSync(join(out, each), readFileSync(join(work, each)))
  if (!args.keep) rmSync(work, { recursive: true, force: true })
  console.log(`prove: ${failed ? 'FAIL' : 'PASS'} in ${manifest.seconds}s; ${manifest.screens.length} screens in ${out}/index.html${diff ? `; ${diff.changed.length} changed since the last run: ${diff.changed.map((each) => each.name).join(', ') || 'none'}` : ''}`)
  process.exit()
}
