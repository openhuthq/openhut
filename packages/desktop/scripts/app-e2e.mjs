import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as tcpServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { bootCloud, devCloudUrl, signIn } from './dev-cloud.mjs'

const { values: args } = parseArgs({ options: { installer: { type: 'string' }, app: { type: 'string' }, dev: { type: 'boolean', default: false }, out: { type: 'string', default: 'app-e2e' }, agents: { type: 'string', default: '5' }, cloud: { type: 'string' } } })
if (!args.installer && !args.app && !args.dev) {
  console.error('usage: node scripts/app-e2e.mjs (--installer <OpenHut-Setup-x64.exe> | --app <OpenHut.app or linux-unpacked> | --dev) [--out <evidence folder>] [--agents 5] [--cloud <private/api>]')
  process.exit(2)
}
const WIN = process.platform === 'win32'
const LINUX = process.platform === 'linux'
const NAMES = ['Juniper', 'Atlas', 'Birch', 'Cedar', 'Dahlia', 'Elm', 'Fern', 'Grove']
const DESKTOP = resolve(import.meta.dirname, '..')
let exe = args.dev ? createRequire(import.meta.url)('electron') : args.app ? resolve(args.app, LINUX ? 'openhut' : 'Contents/MacOS/OpenHut') : ''
const home = resolve(args.out, 'home')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const guestPort = cdpPort + 500
const INVITEE = 'sara@example.com'
const API = devCloudUrl()
const env = { ...process.env, OPENHUT_TEST_HOME: home, OPENHUT_SECOND_APP: '1', OPENHUT_MODEL: 'test', OPENHUT_UPDATE_FEED: 'http://127.0.0.1:9/', ...args.cloud && { OPENHUT_API_URL: API, OPENHUT_CLOUD_URL: API } }
const evidence = { platform: `${process.platform} ${osVersion()}`, steps: [], waits: [] }
mkdirSync(args.out, { recursive: true })
const say = (step, detail = {}) => {
  evidence.steps.push({ step, ...detail, at: new Date().toISOString() })
  console.log(`app-e2e: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

let child
let guest
let api
const site = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>OpenHut e2e page</title><h1>OpenHut e2e page</h1>')).listen(0, '127.0.0.1')
try {
  if (args.cloud) {
    api = await bootCloud({ dir: args.cloud, api: API, log: join(home, 'logs', 'cloud-api.log') })
    say('the dev cloud API is up', { url: API })
  }
  if (args.installer) {
    const programs = join(process.env.LOCALAPPDATA, 'Programs')
    execFileSync(args.installer, ['/S'])
    exe = await until(async () => existsSync(programs) && readdirSync(programs).map((dir) => join(programs, dir, 'OpenHut.exe')).find((path) => existsSync(path)), 60, 'the installer to put OpenHut.exe in place')
  }
  say('installed', { exe })
  child = launch()
  let page = await connect()
  await shot(page, '01-welcome')
  const admin = await until(async () => {
    const reply = await get(page, '/api/admin')
    return reply?.server?.healthy ? reply : null
  }, 60, 'the runtime to be healthy')
  say('the runtime is up and healthy', { build: admin.server.build })
  if (args.cloud) {
    await signIn({ page, api: API })
    say('signed in to the dev cloud as mo@example.com and saved the kit')
    await shot(page, '01-signed-in')
  }
  const agent = await firstAgent(page)
  await page.eval(`fetch('/api/agents/${agent.id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wanted: 'running' }) }).then((r) => r.json())`)
  const [running] = await answering(page, [agent.id], 'the agent to be running and answering')
  say('made an agent and started it', { id: running.id, name: running.name, status: running.status, health: running.health })
  await chat(page, agent, `hello from ${agent.name}`)
  const cleared = await page.eval(`fetch('/api/threads/${agent.id}', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploads: [] }) }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 300) }))`)
  say('cleared the chat, as Clear chat does (a DELETE with a body through the app)', cleared)
  if (cleared.status !== 200) throw new Error(`Clear chat answered ${cleared.status} ${cleared.body}`)
  await page.eval(`navigation.navigate('/agents/${agent.id}')`)
  await sleep(3000)
  await shot(page, '02-agent-page')
  await many(page, agent)
  if (WIN) {
    const pipes = readdirSync('\\\\.\\pipe\\').filter((name) => name.startsWith('openhut-'))
    say('the runtime listens on a named pipe, not a file or TCP', { pipes })
    if (!pipes.length) throw new Error('expected the server pipe, found none')
  }
  await quit(child)
  await sleep(3000)
  const left = leftovers()
  say('quit the app; no agent or browser process is left', { left })
  if (left.length) throw new Error(`after quitting, these are still running: ${left.join('; ')}`)
  child = launch()
  page = await connect()
  const [back] = await answering(page, [agent.id], 'the agent to run again after a restart')
  say('relaunched: the agent survived the restart and runs again', { id: back.id, status: back.status, health: back.health })
  await page.eval(`navigation.navigate('/agents/${agent.id}')`)
  await sleep(3000)
  await shot(page, '03-after-restart')
  if (args.cloud) await invite(page)
  await quit(child)
  await sleep(3000)
  const gone = leftovers()
  say('quit both apps; no agent or browser process is left', { left: gone })
  if (gone.length) throw new Error(`after quitting both apps, these are still running: ${gone.join('; ')}`)
  evidence.failedRequests = page.failures
  evidence.pass = true
} catch (error) {
  evidence.pass = false
  evidence.error = error.message
  console.error(`app-e2e: FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  for (const each of [guest, child]) if (each && each.exitCode === null) await quit(each).catch(() => each.kill())
  api?.kill()
  site.close()
  writeFileSync(join(args.out, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`app-e2e: ${evidence.pass ? 'PASS' : 'FAIL'}; evidence in ${args.out}`)
}

async function invite(mo) {
  const team = (await get(mo, '/api/cloud'))?.workspaces?.find((each) => each.home)
  if (!team) throw new Error(`Mo's app has no home team to invite to: ${JSON.stringify(await get(mo, '/api/cloud'))}`)
  const made = await post(mo, '/api/invitations/cloud', { workspace: team.id, email: INVITEE, role: 'member' })
  if (made.status !== 200) throw new Error(`inviting ${INVITEE} answered ${made.status} ${JSON.stringify(made.body)}`)
  const link = made.body.link.replace('https://openhut.dev/', 'openhut-dev://')
  say(`Mo invited ${INVITEE}, as Invite on the People page does`, { workspace: team.id, team: team.name, invite: made.body.id, expiresAt: made.body.expiresAt })
  const environment = { ...env, OPENHUT_TEST_HOME: resolve(args.out, 'home2'), OPENHUT_GATEWAY_PORT: String(await freePort()) }
  const pending = join(environment.OPENHUT_TEST_HOME, 'invite')
  guest = launch({ port: guestPort, environment, link, who: 'the invitee\'s app' })
  let page = await connect(guestPort)
  await joinScreen(page, 'opened from the invite link')
  await until(async () => (await get(page, '/api/admin'))?.server?.healthy, 60, 'the invitee\'s runtime to be healthy')
  await shot(page, '04-invite-opened')
  if (!existsSync(pending)) throw new Error(`the invitee's app didn't keep the invite in ${pending}`)
  await quit(guest)
  say('quit the invitee\'s app before joining')
  guest = launch({ port: guestPort, environment, who: 'the invitee\'s app' })
  page = await connect(guestPort)
  await joinScreen(page, 'relaunched without the link: the invite is still pending')
  await shot(page, '05-invite-kept')
  await signIn({ page, api: API, email: INVITEE })
  say(`signed the invitee's app in to the dev cloud as ${INVITEE}`)
  await until(async () => (await buttonOf(page, 'Join team')) || null, 60, 'the Join team button')
  say('the join screen shows the team and Join team', { text: await textOf(page) })
  await shot(page, '06-join-team')
  await clickButton(page, 'Join team')
  await until(async () => /You.re in/.test(await textOf(page)) && shot(page, '07-youre-in', 0).then(() => true), 60, '"You’re in"')
  say('clicked Join team; the invitee sees "You’re in"', { text: await textOf(page) })
  const joined = await until(async () => (await get(page, '/api/cloud'))?.workspaces?.find((each) => each.id === team.id && !each.waiting), 60, 'Mo\'s app to send the team key to the invitee')
  say('Mo\'s running app let the invitee in on its own: the invitee holds the team key', { team: joined.name, members: joined.members.map((each) => each.email) })
  const seen = await until(async () => (await get(mo, '/api/cloud'))?.workspaces?.find((each) => each.id === team.id && each.members.some((member) => member.email === INVITEE)), 60, `Mo's app to list ${INVITEE} as a member`)
  say(`Mo's app lists ${INVITEE} in the team`, { members: seen.members.map((each) => each.email), invites: seen.invites.map((each) => each.email) })
  await shot(page, '08-invitee-in')
  await quit(guest)
  say('quit the invitee\'s app')
}

async function joinScreen(page, how) {
  const text = await until(async () => {
    const now = await page.eval("location.pathname === '/join' && document.body?.innerText")
    return now && /You.re invited|Join /.test(now) ? now : null
  }, 60, `the join screen (${how})`)
  say(`the invitee's app shows the join screen, ${how}`, { text: text.slice(0, 200) })
}

async function textOf(page) {
  return String(await page.eval('document.body?.innerText') ?? '').slice(0, 300)
}

async function buttonOf(page, label) {
  return page.eval(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`)
}

async function clickButton(page, label) {
  const clicked = await page.eval(`(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); button?.click(); return Boolean(button) })()`)
  if (!clicked) throw new Error(`there's no ${label} button: ${await textOf(page)}`)
}

async function post(page, path, body) {
  return page.eval(`fetch('${path}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
}

function freePort() {
  return new Promise((done) => {
    const server = tcpServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

async function firstAgent(page) {
  const clicked = await page.eval(`(() => { const start = [...document.querySelectorAll('button')].find((b) => /Start/.test(b.textContent)); start?.click(); return Boolean(start) })()`)
  if (!clicked) await page.eval('window.openhut.firstRun(true)')
  let last
  const started = Date.now()
  const seen = new Set()
  evidence.firstRun = []
  const setup = await until(async () => {
    const run = last = await page.eval('window.openhut.firstRun(false)')
    if (run.failed) throw new Error(`first run failed: ${JSON.stringify(run.steps)}`)
    const now = run.steps.find((step) => step[2] === 'now')
    evidence.firstRun.push({ sec: Math.round((Date.now() - started) / 1000), now })
    const phase = now ? `${now[0]} ${Math.floor((now[3] ?? 0) * 4)}` : 'done'
    if (clicked && !seen.has(phase)) {
      seen.add(phase)
      await shot(page, `00-first-run-${seen.size}`)
    }
    return run.done ? run : null
  }, 120, 'the first run to finish').catch((error) => { throw new Error(`${error.message}; first run was at ${JSON.stringify(last?.steps)}`) })
  say('first run finished: the runtime is ready', { steps: setup.steps })
  const made = await page.eval("fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Juniper' }) }).then(async (r) => ({ status: r.status, body: await r.json() }))")
  if (made.status !== 200) throw new Error(`making the first agent answered ${made.status} ${JSON.stringify(made.body)}`)
  say('made the first agent, as Make your first agent does', { id: made.body.id })
  return made.body
}

async function chat(page, agent, text) {
    const stream = await page.eval(`fetch('/api/threads/${agent.id}/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: ${JSON.stringify(JSON.stringify(text))} }] } }) }).then((r) => r.text())`)
  const echoed = stream.includes('ECHO') && stream.includes(text)
  const crossed = NAMES.filter((name) => name !== agent.name && stream.includes(`hello from ${name}`))
  say(`chatted with ${agent.name} through the gateway`, { text, echoed, crossed, tail: stream.slice(-200) })
  if (!echoed) throw new Error(`${agent.name} didn't echo "${text}" back`)
  if (crossed.length) throw new Error(`${agent.name}'s answer carried another agent's message: ${crossed.join(', ')}`)
}

async function get(page, path) {
  const reply = await page.eval(`fetch('${path}').then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : await r.text() }), () => null)`)
  if (reply?.status === 401 || reply?.status === 403) throw new Error(`GET ${path} answered ${reply.status}, which waiting won't change: ${String(reply.body).slice(0, 300)}`)
  return reply?.status === 200 ? reply.body : null
}

async function agentOf(page, id) {
  const agent = await get(page, `/api/agents/${id}`)
  if (agent?.health === 'not_answering' || agent?.health === 'no_seat') throw new Error(`${agent.name} is ${agent.health}, which waiting won't change: ${agent.healthDetail}`)
  return agent
}

async function wanted(page, id, state) {
  await page.eval(`fetch('/api/agents/${id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wanted: '${state}' }) }).then((r) => r.json())`)
}

async function answering(page, ids, what) {
  return until(async () => {
    const now = await Promise.all(ids.map((id) => agentOf(page, id)))
    return now.every((each) => each?.status === 'running' && each.health === 'answering') ? now : null
  }, 60, what)
}

async function browsers(page, pair) {
  const features = (await page.eval("fetch('/api/admin').then((r) => r.json())")).features
  say('Browser and WhatsApp are available on this computer', { features })
  if (!features?.browser || !features?.whatsapp) {
    const bridge = join(resources(), 'backend/runtime/hermes/scripts/whatsapp-bridge')
    throw new Error(`expected Browser and WhatsApp, got ${JSON.stringify(features)}; ${bridge} holds ${existsSync(bridge) ? readdirSync(bridge).join(', ') : 'nothing'}`)
  }
  for (const agent of pair) await page.eval(`fetch('/api/agents/${agent.id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser: true, codeExecution: true }) }).then((r) => r.json())`)
  await answering(page, pair.map((each) => each.id), 'the two browser agents to answer')
  await Promise.all(pair.map((agent) => tool(page, agent, `browser: open http://127.0.0.1:${site.address().port}/?agent=${agent.name}`, 'OpenHut e2e page')))
  await Promise.all(pair.map((agent) => tool(page, agent, 'browser: get url', `agent=${agent.name}`)))
  say(`${pair.map((each) => each.name).join(' and ')} each opened a page in their own browser at the same time, and each still sees its own page`)
}

async function tool(page, agent, text, expect) {
  let stream = ''
  await until(async () => {
        stream = await page.eval(`fetch('/api/threads/${agent.id}/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: ${JSON.stringify(JSON.stringify(text))} }] } }) }).then((r) => r.text())`)
    return !stream.includes("isn't reachable")
  }, 60, `${agent.name} to come back after turning Browser on`)
  const ok = stream.includes(expect)
  say(`${agent.name} ran "${text}"`, { ok, tail: stream.slice(-300) })
  if (!ok) throw new Error(`${agent.name} ran "${text}" but the answer has no "${expect}": ${stream.slice(-600)}`)
}

async function many(page, first) {
  const count = Number(args.agents)
  const agents = [first]
  for (const name of NAMES.slice(1, count)) agents.push(await page.eval(`fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '${name}' }) }).then((r) => r.json())`))
  const started = Date.now()
  for (const agent of agents) await wanted(page, agent.id, 'running')
  await answering(page, agents.map((each) => each.id), `all ${count} agents to answer`)
  say(`${count} agents run at once and all answer`, { agents: agents.map((each) => each.name), seconds: Math.round((Date.now() - started) / 1000) })
  await Promise.all(agents.map((agent) => chat(page, agent, `hello from ${agent.name}`)))
  say(`chatted with all ${count} at the same time; each answered its own message`)
  await page.eval("navigation.navigate('/agents')")
  await shot(page, '02b-many-agents')
  const [, stopped, ...rest] = agents
  await wanted(page, stopped.id, 'stopped')
  await until(async () => (await agentOf(page, stopped.id))?.status === 'stopped', 60, `${stopped.name} to stop`)
  const others = [agents[0], ...rest]
  await answering(page, others.map((each) => each.id), 'the others to keep answering')
  for (const agent of others) await chat(page, agent, `still here, ${agent.name}`)
  say(`stopped ${stopped.name}; the other ${others.length} kept running and answering`)
  await wanted(page, stopped.id, 'running')
  await answering(page, agents.map((each) => each.id), `${stopped.name} to answer again`)
  await chat(page, stopped, `welcome back, ${stopped.name}`)
  say(`started ${stopped.name} again; all ${count} answer`)
  await browsers(page, agents.slice(1, 3))
  evidence.agents = agents.map((each) => ({ id: each.id, name: each.name }))
}

function leftovers() {
  const backend = join(resources(), 'backend')
  const lines = WIN
    ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" }']).toString().split(/\r?\n/)
    : execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')
  return lines.filter((line) => line.includes(resolve(backend)) && /agent-browser|python|hermes/.test(line)).map((line) => line.trim().slice(-220))
}

function osVersion() {
  if (WIN) return execFileSync('cmd', ['/c', 'ver']).toString().trim()
  if (LINUX) return execFileSync('uname', ['-r']).toString().trim()
  return execFileSync('sw_vers', ['-productVersion']).toString().trim()
}

function resources() {
  if (args.dev) return join(DESKTOP, 'dist')
  return join(dirname(exe), WIN || LINUX ? 'resources' : '../Resources')
}

function launch({ port = cdpPort, environment = env, link, who = 'app' } = {}) {
  const proc = spawn(exe, [...args.dev ? [DESKTOP] : [], `--remote-debugging-port=${port}`, ...LINUX ? ['--no-sandbox', '--password-store=basic'] : [], ...link ? [link] : []], { env: environment, stdio: 'ignore' })
  proc.on('exit', (code) => say(`${who} process exited`, { code }))
  return proc
}

async function quit(proc) {
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  if (WIN) execFileSync('taskkill', ['/PID', String(proc.pid)])
  else proc.kill('SIGTERM')
  await Promise.race([exited, sleep(60_000).then(() => { throw new Error('the app didn\'t quit within a minute') })])
}

async function shot(page, name, settle = 2000) {
  await sleep(settle)
  const broken = await page.eval("document.body.innerText.match(/Failed to fetch|Something went wrong|isn't answering|didn't answer/)?.[0] ?? ''")
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(args.out, `${name}.png`), Buffer.from(data, 'base64'))
  if (broken) throw new Error(`${name} shows "${broken}"; /api/me answers ${await page.eval("fetch('/api/me').then(async (r) => `${r.status} ${await r.text()}`, (e) => e.message)")}; failed requests: ${JSON.stringify(page.failures.slice(-10))}`)
}

async function connect(port = cdpPort) {
  const target = await until(async () => {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
    return list.find((each) => each.type === 'page' && each.url.startsWith('app://openhut'))
  }, 60, 'the app window')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const waiting = new Map()
  const urls = new Map()
  let id = 0
  const failures = []
  socket.onmessage = (message) => {
    const reply = JSON.parse(message.data)
    if (reply.method === 'Network.requestWillBeSent') urls.set(reply.params.requestId, `${reply.params.request.method} ${reply.params.request.url}`)
    if (reply.method === 'Network.loadingFailed' && !reply.params.canceled) failures.push({ request: urls.get(reply.params.requestId), error: reply.params.errorText, at: new Date().toISOString() })
    if (reply.method === 'Runtime.exceptionThrown' || (reply.method === 'Runtime.consoleAPICalled' && reply.params.type === 'error')) failures.push({ console: JSON.stringify(reply.params).slice(0, 400) })
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  }
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id
    waiting.set(n, (reply) => reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result))
    socket.send(JSON.stringify({ id: n, method, params }))
    setTimeout(() => waiting.has(n) && (waiting.delete(n), reject(new Error(`no answer to ${method}`))), 60_000)
  })
  await send('Network.enable', {})
  await send('Runtime.enable', {})
  return {
    failures,
    send,
    eval: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error')
      return result.result?.value
    },
  }
}

async function until(check, seconds, what) {
  const started = Date.now()
  const waited = (outcome) => evidence.waits.push({ what, seconds: Math.round((Date.now() - started) / 1000), limit: seconds, outcome })
  for (const end = started + seconds * 1000; Date.now() < end; await sleep(1000)) {
    const gone = [child, guest].find((each) => each && (each.exitCode !== null || each.signalCode !== null))
    if (gone) {
      waited('app exited')
      throw new Error(`${gone === guest ? 'the invitee\'s app' : 'the app'} exited (${gone.exitCode ?? gone.signalCode}) while waiting for ${what}`)
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
