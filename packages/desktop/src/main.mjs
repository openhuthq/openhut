import { app, autoUpdater as squirrel, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, Menu, net, Notification, powerSaveBlocker, protocol, safeStorage, screen, shell, systemPreferences, Tray, utilityProcess } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { appendFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { cpus, homedir, totalmem } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import updater from 'electron-updater'
import WebSocket from 'ws'
import { DEV_NAME, devBuild, devCloud, devLabel } from './dev-build.mjs'
import { linkHandler } from './desktop-entry.mjs'
import { invitePath } from './invite-link.mjs'
import { linkPath } from './open-link.mjs'
import { cosigned, RELEASE_KEY } from './release-key.mjs'
import { useChannel } from './update-channel.mjs'

const DEV = !app.isPackaged
const MAC = process.platform === 'darwin'
const WIN = process.platform === 'win32'
if (WIN) process.env.NODE_PENDING_PIPE_INSTANCES ??= '64'
const APPIMAGE = process.env.APPIMAGE
const ASKS_PASSWORD = process.platform === 'linux' && !APPIMAGE
process.umask(0o022)
const TEST_HOME = process.env.OPENHUT_TEST_HOME
const RELEASE_FEED = app.getName() !== DEV_NAME
const LOOKS_DEV = devBuild({ packaged: app.isPackaged, name: app.getName(), testHome: TEST_HOME })
const NAME = LOOKS_DEV ? DEV_NAME : 'OpenHut'
const SCHEME = LOOKS_DEV ? 'openhut-dev' : 'openhut'
const CLOUD = LOOKS_DEV ? devCloud(process.env) : {}
const USER_DATA = TEST_HOME || join(app.getPath('appData'), LOOKS_DEV ? 'OpenHut Dev' : 'OpenHut')
app.setName('OpenHut')
app.setPath('userData', process.env.OPENHUT_SECOND_APP ? USER_DATA : join(app.getPath('appData'), 'OpenHut'))
if (!app.requestSingleInstanceLock()) app.exit(0)
app.setName(NAME)
app.setPath('userData', USER_DATA)
app.setAppLogsPath(TEST_HOME ? join(TEST_HOME, 'logs') : LOOKS_DEV && MAC ? join(app.getPath('home'), 'Library/Logs/OpenHut Dev') : undefined)
if (!DEV && !APPIMAGE) app.setAsDefaultProtocolClient(SCHEME)
app.on('second-instance', (_event, argv) => app.whenReady().then(() => {
  const url = argv.find((arg) => arg.startsWith(`${SCHEME}:`))
  if (url) return openLink(url)
  if (opened || main) show()
}))

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const BACKEND = DEV ? ROOT : join(process.resourcesPath, 'backend')
const SCRIPTS = { server: DEV ? 'packages/runtime/src/server/app.ts' : 'packages/runtime/src/server/platform/app.mjs' }
const RUNTIME = process.env.AGENTD_HERMES ?? join(BACKEND, DEV ? 'packages/desktop/dist/backend/runtime' : 'runtime')
const NATIVE_BIN = join(BACKEND, DEV ? 'packages/desktop/dist/backend/bin/native' : 'bin/native')
const GATEWAY_PORT = Number(process.env.OPENHUT_GATEWAY_PORT ?? (LOOKS_DEV ? 8091 : 8081))
const HOME = app.getPath('userData')
const ASSETS = DEV ? ROOT : join(HOME, 'assets', app.getVersion())
const LOGS = app.getPath('logs')
const DATA = join(HOME, 'data')
const BEFORE = join(DATA, 'app.before-update')
const BOOTED = join(DATA, 'booted-version')
const PREVIOUS = join(HOME, 'previous')
const SKIPPED = join(HOME, 'skipped-version')
const BUNDLE = join(dirname(app.getPath('exe')), '../..')
const PIPES = WIN && `\\\\.\\pipe\\openhut-${createHash('sha256').update(HOME).digest('hex').slice(0, 12)}`
const sockAt = (name) => PIPES ? `${PIPES}-${name}` : join(HOME, `${name}.sock`)
const SERVER_SOCK = sockAt('server')
const WINDOW_STATE = join(HOME, 'window.json')
const PREFS = join(HOME, 'prefs.json')
const SECRET = join(HOME, 'secret.bin')
const PENDING_INVITE = join(HOME, 'invite')
const HANDOFF = join(DATA, 'app', 'secret.handoff')
const LOCAL = { name: MAC ? 'This Mac' : 'This computer' }
const EDGE_INSTALL_URL = 'https://openhut.dev/edge'
const INSTALL_URL = process.env.OPENHUT_INSTALL_URL || bakedInstallUrl()
const JOIN_CODE = /^[\w.~:/?#=&%-]{1,500}$/
const AUTOSTART = join(app.getPath('appData'), 'autostart/openhut.desktop')
const DEFAULT_PREFS = { keepAwake: true, betaUpdates: false }
const CANVAS = '#f4f3f5'
const WATCH_RETRY_MS = 30_000
const REFRESH_MS = 500
const TROUBLE_MS = 10_000
const WATCHED = new Set(['agent', 'thread'])
const HEALTHY_MS = 120_000
const RENDERER = join(HERE, '../dist/renderer')
const APP_ORIGIN = 'app://openhut'
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
const MAX_LOG = 10 << 20
const PIPE_TRIES = 20
const children = new Map()
const restarts = { server: 0 }
const logs = {}
const serverEnv = {}
const watched = { threads: new Map(), strikes: new Map(), menu: '', tries: 0 }
let quitting = false
let main
let tray
let blocker
let setup
let booted
let linked = ownLink(process.argv.find((arg) => arg.startsWith(`${SCHEME}:`)))
let fresh = false
let carriedInvite = false
let opened = false
const updating = { checking: false, available: null, progress: 0, ready: null, installing: false, error: null }
let downloaded = ''
const UPDATE_EVERY_MS = 30 * 60_000
let updateCheck = { at: 0, quiet: false }
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
crashReporter.start({ uploadToServer: false })

function start(name, env) {
  const script = join(BACKEND, SCRIPTS[name])
  const child = DEV
    ? spawn('node', [script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    : utilityProcess.fork(script, [], { env: { ...process.env, ...env }, stdio: 'pipe', serviceName: `OpenHut ${name}` })
  logs[name] ??= createWriteStream(join(LOGS, `${name}.log`), { flags: 'a' })
  for (const stream of [child.stdout, child.stderr]) stream?.pipe(logs[name], { end: false })
  children.set(name, child)
  const born = Date.now()
  child.on('exit', (code) => {
    children.delete(name)
    if (quitting) return
    if (Date.now() - born > HEALTHY_MS) restarts[name] = 0
    const seconds = Math.min(30, 2 ** restarts[name]++)
    logs[name].write(`openhut: ${name} exited with ${code}; starting it again in ${seconds}s\n`)
    setTimeout(() => start(name, env), seconds * 1000)
  })
}

async function waitFor(check, seconds) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(250)) {
    if (await check().catch(() => false)) return true
  }
  return false
}

const TAILSCALE = ['C:\\Program Files\\Tailscale\\tailscale.exe', '/usr/bin/tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].find((path) => existsSync(path))

function tailnet() {
  if (!TAILSCALE) return Promise.resolve({ state: 'missing' })
  return new Promise((resolve) => execFile(TAILSCALE, ['status', '--json'], { timeout: 10_000, maxBuffer: 8 << 20 }, (error, stdout) => {
    if (error) return resolve({ state: 'stopped' })
    const status = JSON.parse(stdout)
    if (status.BackendState !== 'Running') return resolve({ state: 'stopped' })
    const peer = (p) => ({ name: p.HostName, dns: (p.DNSName ?? '').replace(/\.$/, ''), os: p.OS, ip: (p.TailscaleIPs ?? [])[0] ?? '', online: !!p.Online, ssh: (p.sshHostKeys ?? []).length > 0 })
    resolve({ state: 'running', tailnet: status.CurrentTailnet?.Name ?? '', self: { name: status.Self?.HostName ?? LOCAL.name, os: status.Self?.OS ?? '', ip: (status.Self?.TailscaleIPs ?? [])[0] ?? '' }, peers: Object.values(status.Peer ?? {}).map(peer) })
  }))
}

const fromApp = (event) => event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)

function machine() {
  const paths = [DATA, LOGS].filter((path) => existsSync(path))
  return new Promise((resolve) => execFile('du', ['-skc', ...paths], { timeout: 20_000 }, (_error, stdout) => {
    const total = Number.parseInt(String(stdout).trim().split('\n').at(-1) ?? '', 10) || 0
    resolve({ chip: cpus()[0]?.model ?? '', memory: totalmem(), folder: HOME, size: total * 1024 })
  }))
}

const handle = (name, fn) => ipcMain.handle(name, (event, arg) => fromApp(event) ? fn(arg) : { error: 'Not allowed.' })
handle('tailnet', tailnet)
handle('machine', machine)
handle('show-folder', () => shell.openPath(HOME))
handle('prefs', prefsNow)
handle('set-prefs', setPrefs)
handle('first-run', () => firstRun())
handle('update.state', updateState)
handle('update.check', () => DEV ? updateState() : checkForUpdate())
handle('update.install', () => {
  if (!updating.ready || updating.installing) return { installing: updating.installing }
  if (ASKS_PASSWORD) installDeb()
  else setImmediate(() => updater.autoUpdater.quitAndInstall())
  return { installing: true }
})
handle('computers.add', answer(enroll))
handle('computers.enrollments', () => [...enrollments.values()])
handle('computers.dismiss', ({ dns } = {}) => { enrollments.delete(dns); shareEnrollments(); return { dns } })
handle('passkey.status', () => passkey(['status']))
handle('passkey.create', ({ email } = {}) => passkey(['create', String(email)]))
handle('passkey.open', ({ quiet } = {}) => passkey(quiet ? ['open', '--quiet'] : ['open']))
handle('passkey.cancel', () => { passkeyRun?.kill() })
handle('touchid.prompt', ({ reason } = {}) => process.platform !== 'darwin' ? { ok: true } : systemPreferences.promptTouchID(String(reason)).then(() => ({ ok: true }), (error) => ({ ok: /not available|not enrolled|no identities/i.test(error.message), error: error.message })))
handle('cloud.notify', ({ title = 'Unlock OpenHut', body = 'Bring your agents and chats to this computer.', path = '/' } = {}) => new Promise((resolve) => {
  if (!Notification.isSupported()) return resolve({ shown: false })
  const note = new Notification({ title: String(title), body: String(body) })
  note.on('click', () => show(String(path).startsWith('/settings/') ? String(path) : '/'))
  note.on('show', () => resolve({ shown: true }))
  note.on('failed', () => resolve({ shown: false }))
  setTimeout(() => resolve({ shown: false }), 3000)
  note.show()
}))
handle('kit.save', saveKit)
handle('invite.forget', () => rmSync(PENDING_INVITE, { force: true }))
handle('invite.keep', (path) => keepInvite(String(path ?? '')))
handle('invite.clear-clipboard', clearCarriedInvite)
handle('focus', () => {
  show()
  if (!main.isFocused()) main.flashFrame(true)
})

async function saveKit({ name, body } = {}) {
  const options = { defaultPath: join(app.getPath('documents'), String(name).replaceAll('/', '-')), filters: [{ name: 'Text', extensions: ['txt'] }] }
  const window = BrowserWindow.getFocusedWindow()
  const { canceled, filePath } = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { canceled: true }
  writeFileSync(filePath, String(body), { mode: 0o600 })
  return { text: readFileSync(filePath, 'utf8') }
}

function passkey(args) {
  const helper = join(app.isPackaged ? join(process.resourcesPath, 'passkey') : join(HERE, '..', 'native', 'passkey', 'build'), 'OpenHut Passkey.app', 'Contents', 'MacOS', 'passkey')
  if (process.platform !== 'darwin' || !existsSync(helper)) return { error: 'missing' }
  passkeyRun?.kill()
  return new Promise((resolve) => { passkeyRun = execFile(helper, args, { timeout: 180_000 }, (error, stdout) => {
    try {
      resolve(JSON.parse(String(stdout)))
    } catch {
      resolve({ error: error?.signal === 'SIGTERM' ? 'canceled' : 'failed' })
    }
  }) })
}
let passkeyRun
ipcMain.on('browser-live', (event, path) => void relayLive({ port: event.ports[0], path: fromApp(event) ? path : '' }))

function answer(fn) {
  return (arg) => Promise.resolve().then(() => fn(arg)).catch((error) => ({ error: error.message }))
}

function bakedInstallUrl() {
  try {
    return readFileSync(join(BACKEND, 'INSTALL_URL'), 'utf8').trim() || EDGE_INSTALL_URL
  } catch {
    return EDGE_INSTALL_URL
  }
}

const enrollments = new Map()
const RETRY_MS = 60_000

function shareEnrollments() {
  main?.webContents.send('computers.enrollments', [...enrollments.values()])
}

async function enroll({ peer, join, retried = false } = {}) {
  const dns = String(peer?.dns ?? '').replace(/\.$/, '')
  const entry = { peer: { name: String(peer?.name || dns), dns }, lines: [], url: null, startedAt: Date.now(), status: 'running', error: '', retryAt: null, retried, waitingAt: null, log: '' }
  enrollments.set(dns, entry)
  shareEnrollments()
  try {
    const added = await install({ peer, join: String(join ?? ''), dns, entry })
    enrollments.delete(dns)
    shareEnrollments()
    if (!main?.isFocused()) notify({ title: `${entry.peer.name} is ready`, body: 'Its agents can run there now.', path: '/settings/computers' })
    return added
  } catch (error) {
    const retryAt = !retried && /already running/i.test(error.message) ? Date.now() + RETRY_MS : null
    Object.assign(entry, { status: 'failed', error: error.message, retryAt })
    shareEnrollments()
    if (!retryAt) void boxLog(dns).then((log) => { entry.log = log; shareEnrollments() })
    if (retryAt) setTimeout(() => { if (enrollments.get(dns) === entry) enroll({ peer, join, retried: true }).catch(() => undefined) }, RETRY_MS)
    throw error
  }
}

async function install({ peer, join, dns, entry }) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dns)) throw new Error('Pick a computer from your Tailscale list.')
  if (!JOIN_CODE.test(join)) throw new Error('This join code doesn\'t look right. Close this and add the computer again.')
  if (!TAILSCALE) throw new Error('Tailscale isn\'t installed on this computer. Install it from tailscale.com/download and sign in.')
  if (!/^https?:\/\/[\w.:/-]+$/.test(INSTALL_URL)) throw new Error('OPENHUT_INSTALL_URL isn\'t a plain http(s) address.')
  const say = (line) => {
    entry.lines.push(line)
    entry.url = /https:\/\/login\.tailscale\.com\/\S+/.exec(line)?.[0] ?? entry.url
    shareEnrollments()
  }
  const name = peer.name || dns
  const found = await tailnet()
  const ip = found.state === 'running' ? found.peers.find((each) => each.dns === dns)?.ip : undefined
  if (!ip) throw new Error(`Can't find ${name} on your Tailscale. Check it's on.`)
  say(`Installing OpenHut on ${dns} over Tailscale SSH. It joins through OpenHut Relay.`)
  await tailscaleSsh({ args: ['ssh', `root@${dns}`, `read -r OPENHUT_JOIN; export OPENHUT_JOIN; script=$(curl -fsSL '${INSTALL_URL}') || exit 1; printf '%s\\n' "$script" | OPENHUT_APP_VERSION=${app.getVersion()} sh`], input: `${join}\n`, say })
  say(`${name} is ready. Approve it when it asks to join.`)
  return { name }
}

function boxLog(dns) {
  if (!TAILSCALE || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dns)) return Promise.resolve('')
  return new Promise((resolve) => execFile(TAILSCALE, ['ssh', `root@${dns}`, 'docker exec openhut tail -n 30 /var/log/openhut/app.log 2>/dev/null || tail -n 30 /var/log/openhut/app.log'], { timeout: 15_000 }, (_error, stdout) => resolve(String(stdout ?? '').trim())))
}

function tailscaleSsh({ args, input, say }) {
  return new Promise((resolve, reject) => {
    const child = spawn(TAILSCALE, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(input)
    let last = ''
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream.on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n|\r/)
        rest = lines.pop()
        for (const line of lines.filter((each) => each.trim())) {
          last = line
          say(line)
        }
      })
    }
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`The install stopped: ${last || `tailscale ssh exited with ${code}`}`)))
  })
}

function prefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(PREFS, 'utf8')) }
  } catch {
    return DEFAULT_PREFS
  }
}

function prefsNow() {
  return { ...prefs(), openAtLogin: MAC || WIN ? app.getLoginItemSettings().openAtLogin : existsSync(AUTOSTART) }
}

function setPrefs(patch) {
  const known = Object.entries(patch ?? {}).filter(([name, value]) => (name in DEFAULT_PREFS || name === 'openAtLogin') && typeof value === 'boolean')
  for (const [name, on] of known) {
    if (name === 'openAtLogin') openAtLogin(on)
    else writeFileSync(PREFS, JSON.stringify({ ...prefs(), [name]: on }))
  }
  if (!DEV && RELEASE_FEED && known.some(([name]) => name === 'betaUpdates')) checkForUpdate()
  refresh().catch(() => undefined)
  return prefsNow()
}

function handleLinks() {
  const entry = join(app.getPath('home'), '.local/share/applications/openhut-appimage.desktop')
  const exec = join(app.getPath('home'), '.local/share/openhut/OpenHut.AppImage')
  try {
    mkdirSync(dirname(exec), { recursive: true })
    rmSync(exec, { force: true })
    symlinkSync(APPIMAGE, exec)
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(entry, linkHandler({ exec, argv: process.argv, scheme: SCHEME }))
  } catch {
    return
  }
  execFile('xdg-mime', ['query', 'default', `x-scheme-handler/${SCHEME}`], (_error, current) => {
    if (['', 'openhut-appimage.desktop'].includes(String(current).trim())) execFile('xdg-mime', ['default', 'openhut-appimage.desktop', `x-scheme-handler/${SCHEME}`], () => undefined)
  })
}

async function clearCarriedInvite() {
  if (!carriedInvite || !invitePath(await clipboard.readText())) return
  clipboard.writeText('')
}

function keepInvite(path) {
  if (!invitePath(`https://openhut.dev${path ?? ''}`)) return
  mkdirSync(HOME, { recursive: true })
  writeFileSync(PENDING_INVITE, path, { mode: 0o600 })
}

function pendingInvite() {
  return invitePath(`https://openhut.dev${existsSync(PENDING_INVITE) ? readFileSync(PENDING_INVITE, 'utf8').trim() : ''}`)
}

function carryClipboard(win) {
  let taken = false
  const take = async () => {
    const path = !taken && invitePath(await clipboard.readText())
    if (!path) return taken
    taken = true
    carriedInvite = true
    keepInvite(path)
    await clearCarriedInvite()
    show(path)
    return true
  }
  const focused = new Promise((resolve) => win.once('focus', () => take().then(resolve, () => resolve(taken))))
  const shown = new Promise((resolve) => win.once('ready-to-show', () => setTimeout(() => take().then(resolve, () => resolve(taken)), 300)))
  return shown.then((got) => got || Promise.race([focused, sleep(3000).then(() => taken)]))
}

function openAtLogin(on) {
  if (MAC || WIN) return app.setLoginItemSettings({ openAtLogin: on, args: WIN ? ['--hidden'] : [] })
  if (!on) return rmSync(AUTOSTART, { force: true })
  mkdirSync(dirname(AUTOSTART), { recursive: true })
  writeFileSync(AUTOSTART, `[Desktop Entry]\nType=Application\nName=OpenHut\nComment=Start OpenHut's agents in the background\nExec="${APPIMAGE ?? process.execPath}" --hidden\nX-GNOME-Autostart-enabled=true\n`)
}

async function api(path, { method = 'GET', body } = {}) {
  const req = new Request(`${APP_ORIGIN}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) })
  const res = await toLocal({ req, path })
  const answer = await res.json()
  if (res.status >= 400) throw new Error(answer?.error?.message ?? `The server answered ${res.status}.`)
  return answer
}

async function refresh() {
  const agents = (await api('/api/agents')).data ?? []
  keepAwake(prefs().keepAwake && agents.some((agent) => agent.runsHere && agent.status === 'running'))
  const now = Date.now()
  for (const agent of agents) {
    if (!agent.runsHere || !needsYou(agent)) {
      watched.strikes.delete(agent.id)
      continue
    }
    const strike = watched.strikes.get(agent.id) ?? { since: now, told: false }
    watched.strikes.set(agent.id, strike)
    if (strike.told || now - strike.since < TROUBLE_MS) continue
    strike.told = true
    notify({ title: `${agent.name} stopped answering`, body: agent.healthDetail || 'It isn\'t running. OpenHut keeps trying to start it.', path: `/agents/${agent.id}` })
  }
  app.setBadgeCount([...watched.strikes.values()].filter((strike) => strike.told).length)
  if ([...watched.strikes.values()].some((strike) => !strike.told)) later(TROUBLE_MS)
  for (const thread of (await api('/api/threads')).data ?? []) {
    const before = watched.threads.get(thread.id)
    watched.threads.set(thread.id, thread.updatedAt)
    if (before && before !== thread.updatedAt && !looking()) await notifyReply({ thread, agent: agents.find((each) => each.id === thread.agentId) }).catch(() => undefined)
  }
  trayMenu({ agents })
}

function later(ms = REFRESH_MS) {
  if (watched.timer) return
  watched.timer = setTimeout(() => {
    watched.timer = undefined
    refresh().catch(() => undefined)
  }, ms)
}

function needsYou(agent) {
  return agent.wanted === 'running' && (agent.status !== 'running' || agent.health === 'not_answering' || agent.health === 'no_seat')
}

function looking() {
  return !!main && !main.isDestroyed() && main.isVisible() && main.isFocused()
}

async function notifyReply({ thread, agent }) {
  const last = (await api(`/api/threads/${encodeURIComponent(thread.id)}`)).messages?.at(-1)
  if (last?.role !== 'assistant') return
  const words = last.parts.filter((part) => part.type === 'text').map((part) => part.text).join('').trim()
  if (words) notify({ title: agent?.name ?? 'Your agent', body: words.slice(0, 200), path: `/agents/${thread.agentId}` })
}

function notify({ title, body, path }) {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body })
  note.on('click', () => show(path))
  note.show()
}

function keepAwake(on) {
  if (on && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && blocker !== undefined) {
    powerSaveBlocker.stop(blocker)
    blocker = undefined
  }
}

const STATE_WORDS = { running: 'Running', starting: 'Starting', not_answering: 'Not answering', no_seat: 'Model not connected', stopped: 'Stopped', missing: 'Stopped unexpectedly' }

function stateOf(agent) {
  if (agent.wanted === 'stopped') return 'stopped'
  if (agent.status !== 'running') return agent.status === 'missing' ? 'missing' : 'starting'
  return agent.health === 'answering' || agent.health === null ? 'running' : agent.health
}

function trayMenu({ agents }) {
  if (!tray) return
  const rows = agents.map((agent) => ({ label: `${agent.name}  ·  ${agent.runsHere ? STATE_WORDS[stateOf(agent)] : `On ${agent.runsOnName ?? 'another computer'}`}`, enabled: true, click: () => show(`/agents/${agent.id}`) }))
  const mine = agents.filter((agent) => agent.canEdit)
  const key = JSON.stringify([rows.map((row) => [row.label, row.enabled]), mine.map((agent) => agent.wanted)])
  if (key === watched.menu) return
  watched.menu = key
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(agents.length ? rows : [{ label: 'No agents yet', enabled: false }]),
    { type: 'separator' },
    { label: 'Open OpenHut', click: () => show() },
    { label: 'Start All Agents', enabled: mine.some((agent) => agent.wanted === 'stopped'), click: () => setAll({ agents: mine, wanted: 'running' }) },
    { label: 'Stop All Agents', enabled: mine.some((agent) => agent.wanted === 'running'), click: () => setAll({ agents: mine, wanted: 'stopped' }) },
    { type: 'separator' },
    { label: 'Quit OpenHut', click: () => app.quit() },
  ]))
}

async function setAll({ agents, wanted }) {
  await Promise.all(agents.filter((agent) => agent.wanted !== wanted).map((agent) => api(`/api/agents/${encodeURIComponent(agent.id)}`, { method: 'PATCH', body: { wanted } })))
    .catch((error) => notify({ title: NAME, body: error.message }))
  main?.webContents.send('changed')
  await refresh().catch(() => undefined)
}

function webHeaders(headers) {
  return new Headers(Object.entries(headers).flatMap(([name, value]) => [value].flat().map((each) => [name, String(each)])))
}

function watch() {
  if (MAC) {
    tray = new Tray(join(HERE, 'trayTemplate.png'))
    tray.setToolTip(NAME)
    if (LOOKS_DEV) tray.setTitle('Dev')
  }
  followEvents()
}

async function followEvents() {
  const ws = await liveSocket('/api/events').catch(() => undefined)
  const retry = () => setTimeout(followEvents, Math.min(WATCH_RETRY_MS, 1000 * 2 ** watched.tries++))
  if (!ws) return retry()
  ws.onmessage = ({ data }) => {
    const event = parsed(String(data))
    if (event?.type === 'beat') return ws.send('beat')
    if (event?.type === 'hello') watched.tries = 0
    if (event?.type === 'hello' || WATCHED.has(event?.data?.object)) later()
  }
  ws.onclose = retry
  ws.onerror = () => undefined
}

function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function firstRun() {
  if (fresh && booted && (!setup || setup.failed)) {
    setup = { done: false, failed: false, steps: [['Checked this computer', '', 'now'], ['Starting OpenHut', '', 'next'], ['Setting up agents', '', 'next']] }
    meet(setup).catch((error) => {
      const step = setup.steps.find((each) => each[2] === 'now')
      if (step) step.splice(1, 2, error.message, 'failed')
      setup.failed = true
    })
  }
  return { fresh, ...setup ?? { done: !fresh, failed: false, steps: [] } }
}

async function meet(run) {
  const step = (index, note, state = 'done') => {
    run.steps[index].splice(1, 3, note, state)
    if (state === 'done' && run.steps[index + 1]) run.steps[index + 1][2] = 'now'
  }
  const hardware = `${cpus()[0]?.model ?? 'This computer'} · ${Math.round(totalmem() / 2 ** 30)} GB`
  step(0, hardware)
  const started = await booted
  if (started !== true) throw new Error('OpenHut didn\'t start. Try again. Help › Show Logs has the details.')
  await api('/api/me')
  step(1, `version ${app.getVersion()}`)
  step(2, 'ready')
  run.done = true
}

function listening(path) {
  return new Promise((resolve) => {
    const sock = connect(path)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => resolve(false))
  })
}

async function rootSecret() {
  if (!await safeStorage.isAsyncEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    if (existsSync(SECRET)) throw new Error('The system keychain is locked or missing, so OpenHut can\'t read its root secret. Unlock it or sign in again, then open OpenHut.')
    appendFileSync(join(LOGS, 'server.log'), 'openhut: no system keychain (Keychain, libsecret or KWallet) is available, so the root secret stays in the database\n')
    return
  }
  if (existsSync(HANDOFF)) await keepSecret(readFileSync(HANDOFF, 'utf8').trim())
  if (!existsSync(SECRET)) await keepSecret(randomBytes(32).toString('hex'))
  serverEnv.OPENHUT_SECRET = (await safeStorage.decryptStringAsync(readFileSync(SECRET))).result
}

async function keepSecret(hex) {
  writeFileSync(SECRET, await safeStorage.encryptStringAsync(hex), { mode: 0o600 })
  serverEnv.OPENHUT_SECRET = hex
  rmSync(HANDOFF, { force: true })
}

async function boot() {
  mkdirSync(LOGS, { recursive: true })
  mkdirSync(DATA, { recursive: true })
  for (const file of readdirSync(LOGS).filter((each) => each.endsWith('.log') && !each.endsWith('.old.log'))) {
    if (statSync(join(LOGS, file)).size > MAX_LOG) renameSync(join(LOGS, file), join(LOGS, file.replace(/\.log$/, '.old.log')))
  }
  keepData()
  await assets()
  const shared = { ...CLOUD, OPENHUT_MODEL: process.env.OPENHUT_MODEL ?? (DEV ? 'test' : 'claude'), OPENHUT_BIN: NATIVE_BIN, OPENHUT_CLAUDE: join(DATA, 'claude', WIN ? 'claude.exe' : 'claude') }
  if (!PIPES) rmSync(SERVER_SOCK, { force: true })
  await rootSecret()
  serverEnv.PORT = String(await signInCallbacks())
  start('server', Object.assign(serverEnv, { ...shared, OPENHUT_SANDBOX: process.env.OPENHUT_SANDBOX ?? 'native', AGENTD_DATA: DATA, AGENTD_ASSETS: ASSETS, AGENTD_HERMES: RUNTIME, OPENHUT_DATA: join(DATA, 'app'), OPENHUT_SOCKET: SERVER_SOCK, OPENHUT_APP_SCHEME: SCHEME, OPENHUT_GATEWAY_PORT: String(GATEWAY_PORT), OPENHUT_AGENT_HOST_NET: '1' }))
  if (!await waitFor(() => listening(SERVER_SOCK), 60)) return false
  if (existsSync(HANDOFF)) await keepSecret(readFileSync(HANDOFF, 'utf8').trim())
  return true
}

let callbacks
function signInCallbacks() {
  callbacks ??= new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || !req.url?.startsWith('/api/cloud/callback?')) return res.writeHead(404).end()
      const forward = request({ socketPath: SERVER_SOCK, path: req.url, method: 'GET' }, (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      })
      forward.on('error', () => res.writeHead(502).end())
      forward.end()
    })
    server.once('error', reject).listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  return callbacks
}

function lastBooted() {
  if (existsSync(BOOTED)) return readFileSync(BOOTED, 'utf8').trim()
  const older = existsSync(dirname(ASSETS)) ? readdirSync(dirname(ASSETS)).filter((name) => name !== app.getVersion() && !name.endsWith('.tmp')) : []
  return older.sort((a, b) => statSync(join(dirname(ASSETS), b)).mtimeMs - statSync(join(dirname(ASSETS), a)).mtimeMs)[0] ?? ''
}

function keepData() {
  const last = lastBooted()
  if (DEV || !last || last === app.getVersion() || !existsSync(join(DATA, 'app'))) return
  const step = `${last}->${app.getVersion()}`
  if (existsSync(`${BEFORE}.version`) && readFileSync(`${BEFORE}.version`, 'utf8').trim() === step) return
  rmSync(BEFORE, { recursive: true, force: true })
  cpSync(join(DATA, 'app'), BEFORE, { recursive: true })
  writeFileSync(`${BEFORE}.version`, step)
}

function keepApp(done) {
  if (!MAC || DEV) return done()
  rmSync(PREVIOUS, { recursive: true, force: true })
  mkdirSync(PREVIOUS, { recursive: true })
  execFile('ditto', [BUNDLE, join(PREVIOUS, 'OpenHut.app')], (error) => {
    if (error) appendFileSync(join(LOGS, 'updates.log'), `openhut: couldn't keep a copy of ${app.getVersion()}: ${error.message}\n`)
    else writeFileSync(join(PREVIOUS, 'version'), app.getVersion())
    done()
  })
}

function previousVersion() {
  if (!MAC || DEV || !existsSync(join(PREVIOUS, 'version')) || !existsSync(`${BEFORE}.version`) || lastBooted() === app.getVersion()) return ''
  const version = readFileSync(join(PREVIOUS, 'version'), 'utf8').trim()
  return readFileSync(`${BEFORE}.version`, 'utf8').trim() === `${version}->${app.getVersion()}` ? version : ''
}

function goBack(version) {
  writeFileSync(SKIPPED, app.getVersion())
  const script = 'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done; rm -rf "$BUNDLE.coming-back" "$BUNDLE.going-back" && ditto "$PREVIOUS/OpenHut.app" "$BUNDLE.coming-back" && rm -rf "$DATA/app" && cp -R "$BEFORE" "$DATA/app" && rm -rf "$BEFORE" "$BEFORE.version" && mv "$BUNDLE" "$BUNDLE.going-back" && mv "$BUNDLE.coming-back" "$BUNDLE" && rm -rf "$BUNDLE.going-back" && printf "%s" "$VERSION" > "$DATA/booted-version" && { [ -n "$NO_OPEN" ] || open "$BUNDLE"; }'
  spawn('/bin/sh', ['-c', `(${script}) >> "$LOG" 2>&1`], { detached: true, stdio: 'ignore', env: { ...process.env, PID: String(process.pid), DATA, BEFORE, BUNDLE, PREVIOUS, VERSION: version, LOG: join(LOGS, 'updates.log'), NO_OPEN: TEST_HOME ? '1' : '' } }).unref()
  app.quit()
}

async function assets() {
  rmSync(join(HOME, 'bin'), { recursive: true, force: true })
  if (DEV || existsSync(ASSETS)) return
  rmSync(`${ASSETS}.tmp`, { recursive: true, force: true })
  cpSync(join(BACKEND, 'vendor/hermes-plugins'), join(`${ASSETS}.tmp`, 'vendor/hermes-plugins'), { recursive: true })
  renameSync(`${ASSETS}.tmp`, ASSETS)
  const older = readdirSync(dirname(ASSETS)).filter((name) => name !== app.getVersion() && !name.endsWith('.tmp'))
  for (const name of older.sort((a, b) => statSync(join(dirname(ASSETS), b)).mtimeMs - statSync(join(dirname(ASSETS), a)).mtimeMs).slice(1)) rmSync(join(dirname(ASSETS), name), { recursive: true, force: true })
}

function savedBounds() {
  try {
    const bounds = JSON.parse(readFileSync(WINDOW_STATE, 'utf8'))
    const area = screen.getDisplayMatching(bounds).workArea
    const visible = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y
    return visible ? bounds : {}
  } catch {
    return {}
  }
}

function window(path = '/agents') {
  const win = new BrowserWindow({
    width: 1280, height: 820, ...savedBounds(), minWidth: 900, minHeight: 600, show: false, title: NAME,
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : { autoHideMenuBar: true }),
    backgroundColor: CANVAS,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: DEV, preload: join(HERE, 'preload.cjs'), additionalArguments: [`--openhut-version=${app.getVersion()}`, ...(LOOKS_DEV ? [`--openhut-dev=${devLabel(CLOUD.OPENHUT_CLOUD_URL)}`] : [])] },
  })
  win.on('close', saveBounds)
  win.on('focus', () => win.flashFrame(false))
  win.once('ready-to-show', () => win.show())
  win.loadURL(`${APP_ORIGIN}${path}`)
  main = win
  return win
}

function saveBounds() {
  if (main && !main.isDestroyed()) writeFileSync(WINDOW_STATE, JSON.stringify(main.getNormalBounds()))
}


function ownLink(url) {
  return url?.startsWith(`${SCHEME}:`) ? linkPath(url.replace(SCHEME, 'openhut')) : undefined
}

function openLink(url) {
  linked = ownLink(url)
  keepInvite(linked)
  if ((linked || url?.startsWith(`${SCHEME}:`)) && (opened || main)) show(linked)
}

function show(path) {
  const win = main && !main.isDestroyed() ? main : window()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (path) win.webContents.executeJavaScript(`navigation.navigate(${JSON.stringify(path)})`).catch(() => win.loadURL(`${APP_ORIGIN}${path}`))
}

function guard(contents) {
  const intoApp = (event) => {
    const { protocol, hostname, pathname, search } = new URL(event.url)
    if (!['http:', 'https:', 'app:'].includes(protocol)) return event.preventDefault()
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') return
    event.preventDefault()
    contents.loadURL(`${APP_ORIGIN}${pathname}${search}`)
  }
  contents.on('will-navigate', intoApp)
  contents.on('will-redirect', intoApp)
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return { action: 'allow' }
    if (/^https?:\/\//.test(url) || url.startsWith('cursor://anysphere.cursor-deeplink/')) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return
    const fixes = params.dictionarySuggestions.map((word) => ({ label: word, click: () => contents.replaceMisspelling(word) }))
    const edit = params.isEditable ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }] : [{ role: 'copy' }]
    Menu.buildFromTemplate([...fixes, ...(fixes.length ? [{ type: 'separator' }] : []), ...edit]).popup()
  })
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    MAC ? { label: NAME, submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => show('/settings/general') }, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] } : { label: 'File', submenu: [
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => show('/settings/general') }, { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    ...(DEV ? [{ role: 'viewMenu' }] : []),
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'OpenHut Docs', click: () => shell.openExternal('https://openhut.dev/docs') },
      { label: 'Show Logs', click: () => shell.openPath(LOGS) },
      ...(MAC ? [] : [{ type: 'separator' }, { role: 'about' }]),
    ] },
  ]))
  app.setAboutPanelOptions({ applicationName: NAME, applicationVersion: app.getVersion(), version: '', copyright: 'Copyright © 2026 OpenHut', credits: 'openhut.dev' })
}

function updateState() {
  return { current: app.getVersion(), asksPassword: ASKS_PASSWORD, ...updating }
}

function setUpdate(patch) {
  Object.assign(updating, patch)
  main?.webContents.send('update.changed', updateState())
}

function checkForUpdate() {
  if (updating.ready) return updateState()
  updateCheck = { at: Date.now(), quiet: false }
  setUpdate({ checking: true, error: null })
  return lookForUpdate().then(updateState, updateState)
}

function checkQuietly() {
  if (updating.ready || updating.available || Date.now() - updateCheck.at < UPDATE_EVERY_MS) return
  updateCheck = { at: Date.now(), quiet: true }
  lookForUpdate().catch(() => undefined)
}

function lookForUpdate() {
  useChannel({ updater: updater.autoUpdater, beta: prefs().betaUpdates })
  return updater.autoUpdater.checkForUpdates()
}

function update() {
  const auto = updater.autoUpdater
  const logger = new console.Console(createWriteStream(join(LOGS, 'updates.log'), { flags: 'a' }))
  auto.logger = logger
  if (process.env.OPENHUT_UPDATE_FEED) auto.setFeedURL({ provider: 'generic', url: process.env.OPENHUT_UPDATE_FEED })
  if (TEST_HOME) auto.autoRunAppAfterInstall = false
  if (ASKS_PASSWORD) auto.autoInstallOnAppQuit = false
  auto.on('error', (error) => {
    logger.error(`openhut: update failed: ${error?.stack ?? error}`)
    if (updateCheck.quiet) return
    setUpdate({ checking: false, error: /code ?sign|signature|requirement/i.test(String(error?.message ?? error)) ? 'signature' : 'failed' })
  })
  auto.on('update-not-available', () => setUpdate({ checking: false, available: null }))
  auto.autoDownload = false
  auto.on('update-available', (info) => {
    const version = String(info?.version ?? '')
    if (existsSync(SKIPPED) && readFileSync(SKIPPED, 'utf8').trim() === version) return setUpdate({ checking: false, available: null })
    updateCheck.quiet = false
    void releaseSigned(info).then((ok) => {
      if (auto.updateInfoAndProvider?.info !== info) return
      if (!ok) {
        logger.error(`openhut: ${version} has no valid release signature, so it isn't installed`)
        return setUpdate({ checking: false, available: null, error: 'signature' })
      }
      setUpdate({ checking: false, available: version, progress: 0 })
      auto.downloadUpdate().catch(() => undefined)
    })
  })
  auto.on('download-progress', (info) => {
    const progress = Math.floor(info?.percent ?? 0)
    if (progress !== updating.progress) setUpdate({ progress })
  })
  const ready = () => keepApp(() => setUpdate({ checking: false, error: null, ready: { version: updating.available ?? '' } }))
  if (MAC) squirrel.on('update-downloaded', ready)
  else auto.on('update-downloaded', (info) => {
    downloaded = info?.downloadedFile ?? ''
    ready()
  })
  checkForUpdate()
  setInterval(checkQuietly, UPDATE_EVERY_MS)
  app.on('browser-window-focus', checkQuietly)
}

function installDeb() {
  const log = (line) => appendFileSync(join(LOGS, 'updates.log'), `openhut: ${line}\n`)
  setUpdate({ installing: true, error: null })
  log(`installing ${downloaded} with pkexec dpkg -i`)
  execFile('pkexec', ['dpkg', '-i', downloaded], { maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
    log(`pkexec dpkg -i exited with ${error ? error.code : 0}: ${`${stdout}${stderr}`.trim().slice(-2000)}`)
    if (!error) {
      if (!TEST_HOME) app.relaunch()
      return app.quit()
    }
    setUpdate({ installing: false, error: 'not-installed' })
    main?.show()
    main?.focus()
  })
}

async function releaseSigned(info) {
  const key = (TEST_HOME && process.env.OPENHUT_RELEASE_KEY) || RELEASE_KEY
  if (!key) return true
  const feed = process.env.OPENHUT_UPDATE_FEED || 'https://dl.openhut.dev/'
  const [manifest, signature] = await Promise.all(['release.json', 'release.json.sig'].map((name) => net.fetch(new URL(`v${info.version}/${name}`, feed).href).then((res) => res.ok ? res.text() : '', () => '')))
  return cosigned({ manifest, signature, key, version: String(info.version), files: info.files ?? [] })
}

function serve(req) {
  const { pathname } = new URL(req.url)
  return /^\/(api|c\/[\w-]+\/api)\//.test(pathname) ? toLocal({ req, path: pathname }) : serveRenderer(req)
}

function refuse(status, message) {
  return new Response(JSON.stringify({ error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', message } }), { status, headers: { 'content-type': 'application/json' } })
}

async function toLocal({ req, path }) {
  const origin = req.headers.get('origin')
  if (!['GET', 'HEAD'].includes(req.method) && origin !== null && origin !== APP_ORIGIN) return refuse(403, 'Only the OpenHut app can change things here.')
  const target = path + new URL(req.url).search
  if (await booted !== true) return refuse(502, `OpenHut's runtime didn't start. The logs are in ${LOGS}.`)
  return toSocket({ req, path: target }).catch((error) => refuse(502, `OpenHut's runtime didn't answer (${error.code ?? error.message}). Try again, or restart OpenHut.`))
}

async function relayLive({ port, path }) {
  const ws = await liveSocket(String(path)).catch(() => null)
  if (!ws) {
    port.postMessage(ws === null ? { closed: 1006, reason: '' } : { closed: 4404, reason: 'There\'s no live view at that address.' })
    return port.close()
  }
  port.on('message', ({ data }) => ws.readyState === WebSocket.OPEN && ws.send(String(data)))
  port.on('close', () => ws.close())
  port.start()
  ws.onmessage = ({ data }) => port.postMessage(String(data))
  ws.onclose = ({ code, reason }) => {
    port.postMessage({ closed: code, reason: String(reason) })
    port.close()
  }
  ws.onerror = () => undefined
}

async function liveSocket(path) {
  if (!/^\/api\/(browsers\/[\w-]+\/live(\?fps=\d+)?|events)$/.test(path)) return undefined
  return new WebSocket(`ws://localhost${path}`, { createConnection: () => connect(SERVER_SOCK) })
}

async function toSocket({ req, path }) {
  const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined
  for (let tries = 1; ; tries++) {
    const answer = await socketRequest({ req, path, body }).catch((error) => {
      if (tries >= PIPE_TRIES || !['ENOENT', 'EBUSY'].includes(error.code)) throw error
      appendFileSync(join(LOGS, 'server.log'), `openhut: ${req.method} ${path} got ${error.code} from the runtime's pipe; trying again\n`)
    })
    if (answer) return answer
    await sleep(100)
  }
}

function socketRequest({ req, path, body }) {
  const headers = Object.fromEntries(req.headers)
  delete headers['transfer-encoding']
  if (body) headers['content-length'] = String(body.length)
  return new Promise((resolve, reject) => {
    const out = request({ socketPath: SERVER_SOCK, path, method: req.method, headers }, (res) => {
      const headers = webHeaders(res.headers)
      resolve(new Response([204, 304].includes(res.statusCode) ? null : Readable.toWeb(res), { status: res.statusCode, headers }))
    })
    out.on('error', reject)
    out.end(body)
  })
}

async function serveRenderer(req) {
  const file = join(RENDERER, decodeURIComponent(new URL(req.url).pathname))
  const inside = !relative(RENDERER, file).startsWith('..')
  const res = await net.fetch(pathToFileURL(inside && statSync(file, { throwIfNoEntry: false })?.isFile() ? file : join(RENDERER, 'index.html')).toString())
  const headers = new Headers(res.headers)
  headers.set('content-security-policy', CSP)
  return new Response(res.body, { status: res.status, headers })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  openLink(url)
})
app.on('web-contents-created', (_event, contents) => guard(contents))
app.on('window-all-closed', () => MAC || app.quit())
app.on('before-quit', (event) => {
  saveBounds()
  if (!children.size) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  const exited = [...children.values()].map((child) => new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill()
  }))
  Promise.race([Promise.all(exited), sleep(5000)]).then(() => {
    for (const child of children.values()) child.kill('SIGKILL')
    children.clear()
    app.quit()
  })
})

app.whenReady().then(async () => {
  if (LOOKS_DEV) app.dock?.setIcon(join(HERE, 'icon-dev.png'))
  menu()
  if (APPIMAGE && !DEV) handleLinks()
  protocol.handle('app', serve)
  fresh = !existsSync(join(DATA, 'app'))
  keepInvite(linked)
  if (fresh) window(pendingInvite() ?? '/')
  if (fresh && !pendingInvite() && !TEST_HOME) carryClipboard(main)
  const hidden = process.argv.includes('--hidden') || (MAC && app.getLoginItemSettings().wasOpenedAtLogin)
  booted = boot().catch((error) => {
    appendFileSync(join(LOGS, 'server.log'), `openhut: couldn't start: ${error.message}\n`)
    return error.message
  })
  const started = await booted
  if (started !== true) {
    const back = previousVersion()
    const buttons = [...(back ? [`Go back to ${back}`] : []), 'Open Logs', 'Quit']
    const picked = TEST_HOME && process.env.OPENHUT_TEST_DIALOG ? buttons.findIndex((label) => label.startsWith(process.env.OPENHUT_TEST_DIALOG)) : -1
    const { response } = picked >= 0 ? { response: picked } : await dialog.showMessageBox({ type: 'error', message: 'OpenHut couldn\'t start', detail: `${started || 'Its server didn\'t come up within a minute.'} The logs are in ${LOGS}.`, buttons, defaultId: 0 })
    if (back && response === 0) return goBack(back)
    if (buttons[response] === 'Open Logs') await shell.openPath(LOGS)
    return app.quit()
  }
  writeFileSync(BOOTED, app.getVersion())
  if (!fresh && (!hidden || linked)) window(linked ?? pendingInvite())
  opened = true
  watch()
  if (!DEV && RELEASE_FEED) update()
  app.on('activate', () => show())
})
