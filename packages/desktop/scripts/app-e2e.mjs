import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { installer: { type: 'string' }, app: { type: 'string' }, out: { type: 'string', default: 'app-e2e' }, agents: { type: 'string', default: '5' } } })
if (!args.installer && !args.app) {
  console.error('usage: node scripts/app-e2e.mjs (--installer <OpenHut-Setup-x64.exe> | --app <OpenHut.app>) [--out <evidence folder>] [--agents 5]')
  process.exit(2)
}
const WIN = process.platform === 'win32'
const NAMES = ['Juniper', 'Atlas', 'Birch', 'Cedar', 'Dahlia', 'Elm', 'Fern', 'Grove']
let exe = args.app ? resolve(args.app, 'Contents/MacOS/OpenHut') : ''
const home = resolve(args.out, 'home')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const env = { ...process.env, OPENHUT_TEST_HOME: home, OPENHUT_SECOND_APP: '1', OPENHUT_MODEL: 'test' }
const evidence = { platform: `${process.platform} ${WIN ? execFileSync('cmd', ['/c', 'ver']).toString().trim() : execFileSync('sw_vers', ['-productVersion']).toString().trim()}`, steps: [] }
mkdirSync(args.out, { recursive: true })
const say = (step, detail = {}) => {
  evidence.steps.push({ step, ...detail, at: new Date().toISOString() })
  console.log(`app-e2e: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

let child
try {
  if (args.installer) {
    const programs = join(process.env.LOCALAPPDATA, 'Programs')
    execFileSync(args.installer, ['/S'])
    exe = await until(async () => existsSync(programs) && readdirSync(programs).map((dir) => join(programs, dir, 'OpenHut.exe')).find((path) => existsSync(path)), 120, 'the installer to put OpenHut.exe in place')
  }
  say('installed', { exe })
  child = launch()
  let page = await connect()
  await shot(page, '01-welcome')
  const admin = await until(async () => {
    const reply = await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)")
    return reply?.server?.healthy ? reply : null
  }, 120, 'the runtime to be healthy')
  say('the runtime (server and agentd) is up and healthy', { build: admin.server.build })
  const agent = await firstAgent(page)
  await page.eval(`fetch('/api/agents/${agent.id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wanted: 'running' }) }).then((r) => r.json())`)
  const running = await until(async () => {
    const now = await page.eval(`fetch('/api/agents/${agent.id}').then((r) => r.json())`)
    return now.status === 'running' ? now : null
  }, 300, 'the agent to be running')
  say('made an agent and started it', { id: running.id, name: running.name, status: running.status, health: running.health })
  await chat(page, agent, `hello from ${agent.name}`)
  await page.eval(`navigation.navigate('/agents/${agent.id}')`)
  await sleep(3000)
  await shot(page, '02-agent-page')
  await many(page, agent)
  if (WIN) {
    const pipes = readdirSync('\\\\.\\pipe\\').filter((name) => name.startsWith('openhut-'))
    say('the runtime listens on named pipes, not files or TCP', { pipes })
    if (pipes.length < 3) throw new Error(`expected the agentd, server and mcp pipes, found ${pipes.join(', ') || 'none'}`)
  }
  await mcp(agent)
  await quit()
  await sleep(3000)
  const left = leftovers()
  say('quit the app; no agent or browser process is left', { left })
  if (left.length) throw new Error(`after quitting, these are still running: ${left.join('; ')}`)
  child = launch()
  page = await connect()
  const back = await until(async () => {
    const again = await page.eval(`fetch('/api/agents/${agent.id}').then((r) => r.ok ? r.json() : null, () => null)`)
    return again?.status === 'running' && again.health === 'answering' ? again : null
  }, 300, 'the agent to run again after a restart')
  say('relaunched: the agent survived the restart and runs again', { id: back.id, status: back.status, health: back.health })
  await page.eval(`navigation.navigate('/agents/${agent.id}')`)
  await sleep(3000)
  await shot(page, '03-after-restart')
  evidence.failedRequests = page.failures
  evidence.pass = true
} catch (error) {
  evidence.pass = false
  evidence.error = error.message
  console.error(`app-e2e: FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) await quit().catch(() => child.kill())
  writeFileSync(join(args.out, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`app-e2e: ${evidence.pass ? 'PASS' : 'FAIL'}; evidence in ${args.out}`)
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
    return run.agentId ? run : null
  }, 900, 'the first agent to answer').catch((error) => { throw new Error(`${error.message}; first run was at ${JSON.stringify(last?.steps)}`) })
  say('first run finished: the runtime is ready and the first agent answers', { steps: setup.steps })
  return page.eval(`fetch('/api/agents/${setup.agentId}').then((r) => r.json())`)
}

async function chat(page, agent, text) {
    const stream = await page.eval(`fetch('/api/threads/${agent.id}/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: ${JSON.stringify(JSON.stringify(text))} }] } }) }).then((r) => r.text())`)
  const echoed = stream.includes('ECHO') && stream.includes(text)
  const crossed = NAMES.filter((name) => name !== agent.name && stream.includes(`hello from ${name}`))
  say(`chatted with ${agent.name} through the gateway`, { text, echoed, crossed, tail: stream.slice(-200) })
  if (!echoed) throw new Error(`${agent.name} didn't echo "${text}" back`)
  if (crossed.length) throw new Error(`${agent.name}'s answer carried another agent's message: ${crossed.join(', ')}`)
}

async function agentOf(page, id) {
  return page.eval(`fetch('/api/agents/${id}').then((r) => r.ok ? r.json() : null, () => null)`)
}

async function wanted(page, id, state) {
  await page.eval(`fetch('/api/agents/${id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wanted: '${state}' }) }).then((r) => r.json())`)
}

async function answering(page, ids, what) {
  return until(async () => {
    const now = await Promise.all(ids.map((id) => agentOf(page, id)))
    return now.every((each) => each?.status === 'running' && each.health === 'answering') ? now : null
  }, 300, what)
}

async function browsers(page, pair) {
  const features = (await page.eval("fetch('/api/admin').then((r) => r.json())")).features
  say('Browser and WhatsApp are available on this computer', { features })
  if (!features?.browser || !features?.whatsapp) {
    const bridge = join(dirname(exe), WIN ? 'resources' : '../Resources', 'backend/runtime/hermes/scripts/whatsapp-bridge')
    throw new Error(`expected Browser and WhatsApp, got ${JSON.stringify(features)}; ${bridge} holds ${existsSync(bridge) ? readdirSync(bridge).join(', ') : 'nothing'}`)
  }
  for (const agent of pair) await page.eval(`fetch('/api/agents/${agent.id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser: true, codeExecution: true }) }).then((r) => r.json())`)
  await answering(page, pair.map((each) => each.id), 'the two browser agents to answer')
  await Promise.all(pair.map((agent) => tool(page, agent, `browser: open https://example.com/?agent=${agent.name}`, 'Example Domain')))
  await Promise.all(pair.map((agent) => tool(page, agent, 'browser: get url', `agent=${agent.name}`)))
  say(`${pair.map((each) => each.name).join(' and ')} each opened a page in their own browser at the same time, and each still sees its own page`)
}

async function tool(page, agent, text, expect) {
  let stream = ''
  await until(async () => {
        stream = await page.eval(`fetch('/api/threads/${agent.id}/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: ${JSON.stringify(JSON.stringify(text))} }] } }) }).then((r) => r.text())`)
    return !stream.includes("isn't reachable")
  }, 180, `${agent.name} to come back after turning Browser on`)
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
  await until(async () => (await agentOf(page, stopped.id))?.status === 'stopped', 120, `${stopped.name} to stop`)
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

async function mcp(agent) {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'app-e2e', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } },
  ]
  const proc = spawn(exe, ['--mcp'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  proc.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
  proc.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), sleep(60_000).then(() => { proc.kill(); throw new Error(`OpenHut --mcp didn't finish within a minute; it said ${out.slice(0, 300)}`) })])
  const answers = out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const tools = answers.find((each) => each.id === 2)?.result?.tools?.map((tool) => tool.name) ?? []
  const listed = JSON.stringify(answers.find((each) => each.id === 3)?.result ?? {})
  say('an MCP client reached the runtime through OpenHut --mcp', { tools: tools.length, listAgentsHasJuniper: listed.includes(agent.id) })
  if (!tools.includes('list_agents') || !listed.includes(agent.id)) throw new Error(`the MCP bridge answered ${out.slice(0, 500)}`)
}

function leftovers() {
  const backend = join(dirname(exe), WIN ? 'resources' : '../Resources', 'backend')
  const lines = WIN
    ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" }']).toString().split(/\r?\n/)
    : execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n')
  return lines.filter((line) => line.includes(resolve(backend)) && /agent-browser|python|hermes/.test(line)).map((line) => line.trim().slice(-220))
}

function launch() {
  const proc = spawn(exe, [`--remote-debugging-port=${cdpPort}`], { env, stdio: 'ignore' })
  proc.on('exit', (code) => say('app process exited', { code }))
  return proc
}

async function quit() {
  const exited = new Promise((resolve) => child.once('exit', resolve))
  if (WIN) execFileSync('taskkill', ['/PID', String(child.pid)])
  else child.kill('SIGTERM')
  await Promise.race([exited, sleep(60_000).then(() => { throw new Error('the app didn\'t quit within a minute') })])
}

async function shot(page, name) {
  await sleep(2000)
  const broken = await page.eval("document.body.innerText.match(/Failed to fetch|Something went wrong|isn't answering|didn't answer/)?.[0] ?? ''")
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(args.out, `${name}.png`), Buffer.from(data, 'base64'))
  if (broken) throw new Error(`${name} shows "${broken}"; /api/me answers ${await page.eval("fetch('/api/me').then(async (r) => `${r.status} ${await r.text()}`, (e) => e.message)")}; failed requests: ${JSON.stringify(page.failures.slice(-10))}`)
}

async function connect() {
  const target = await until(async () => {
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json()).catch(() => [])
    return list.find((each) => each.type === 'page' && each.url.startsWith('app://openhut'))
  }, 120, 'the app window')
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
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1000)) {
    const value = await check()
    if (value) return value
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`)
}
