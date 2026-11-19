import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { installer: { type: 'string' }, out: { type: 'string', default: 'windows-e2e' }, sandbox: { type: 'string', default: 'microsandbox' } } })
if (!args.installer) {
  console.error('usage: node scripts/windows-e2e.mjs --installer <OpenHut-Setup-x64.exe> [--out <evidence folder>] [--sandbox microsandbox|memory]')
  process.exit(2)
}
const programs = join(process.env.LOCALAPPDATA, 'Programs')
let exe = ''
const home = resolve(args.out, 'home')
const cdpPort = 9300 + Math.floor(Math.random() * 500)
const real = args.sandbox === 'microsandbox'
const env = { ...process.env, OPENHUT_TEST_HOME: home, OPENHUT_MODEL: 'test', OPENHUT_SANDBOX: args.sandbox }
const evidence = { sandbox: args.sandbox, platform: `${process.platform} ${execFileSync('cmd', ['/c', 'ver']).toString().trim()}`, steps: [] }
mkdirSync(args.out, { recursive: true })
const say = (step, detail = {}) => {
  evidence.steps.push({ step, ...detail, at: new Date().toISOString() })
  console.log(`windows-e2e: ${step}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`)
}

let child
try {
  execFileSync(args.installer, ['/S'])
  exe = await until(async () => existsSync(programs) && readdirSync(programs).map((dir) => join(programs, dir, 'OpenHut.exe')).find((path) => existsSync(path)), 120, 'the installer to put OpenHut.exe in place')
  say('installed', { exe })
  child = launch()
  let page = await connect()
  await shot(page, '01-welcome')
  const admin = await until(async () => {
    const reply = await page.eval("fetch('/api/admin').then((r) => r.ok ? r.json() : null, () => null)")
    return reply?.server?.healthy ? reply : null
  }, 120, 'the runtime to be healthy')
  say('the runtime (server and agentd) is up and healthy', { build: admin.server.build })
  const agent = real ? await firstAgent(page) : await page.eval("fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Juniper' }) }).then((r) => r.json())")
  await page.eval(`fetch('/api/agents/${agent.id}', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wanted: 'running' }) }).then((r) => r.json())`)
  const running = await until(async () => {
    const now = await page.eval(`fetch('/api/agents/${agent.id}').then((r) => r.json())`)
    return now.status === 'running' ? now : null
  }, 300, 'the agent to be running')
  say('made an agent and started it', { id: running.id, name: running.name, status: running.status, health: running.health })
  if (real) await chat(page, agent)
  await page.eval(`navigation.navigate('/agents/${agent.id}')`)
  await sleep(3000)
  await shot(page, '02-agent-page')
  const pipes = readdirSync('\\\\.\\pipe\\').filter((name) => name.startsWith('openhut-'))
  say('the runtime listens on named pipes, not files or TCP', { pipes })
  if (pipes.length < 3) throw new Error(`expected the agentd, server and mcp pipes, found ${pipes.join(', ') || 'none'}`)
  await mcp(agent)
  await quit()
  say('quit the app')
  child = launch()
  page = await connect()
  const back = await until(async () => {
    const again = await page.eval(`fetch('/api/agents/${agent.id}').then((r) => r.ok ? r.json() : null, () => null)`)
    return again?.status === 'running' && (!real || again.health === 'answering') ? again : null
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
  console.error(`windows-e2e: FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) await quit().catch(() => child.kill())
  writeFileSync(join(args.out, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`windows-e2e: ${evidence.pass ? 'PASS' : 'FAIL'}; evidence in ${args.out}`)
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
  say('first run finished: the fence passed and the first agent answers in its microVM', { steps: setup.steps })
  return page.eval(`fetch('/api/agents/${setup.agentId}').then((r) => r.json())`)
}

async function chat(page, agent) {
  const thread = await page.eval(`fetch('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: '${agent.id}' }) }).then((r) => r.json())`)
  const stream = await page.eval(`fetch('/api/threads/${thread.id}/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello from windows' }] } }) }).then((r) => r.text())`)
  const echoed = stream.includes('ECHO') && stream.includes('hello from windows')
  say('chatted with the agent through the gateway', { echoed, tail: stream.slice(-300) })
  if (!echoed) throw new Error('the agent didn\'t echo the message back')
}

async function mcp(agent) {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'windows-e2e', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } },
  ]
  const proc = spawn(exe, ['--mcp'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  proc.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
  proc.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), sleep(60_000).then(() => { proc.kill(); throw new Error(`OpenHut.exe --mcp didn't finish within a minute; it said ${out.slice(0, 300)}`) })])
  const answers = out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const tools = answers.find((each) => each.id === 2)?.result?.tools?.map((tool) => tool.name) ?? []
  const listed = JSON.stringify(answers.find((each) => each.id === 3)?.result ?? {})
  say('an MCP client reached the runtime through OpenHut.exe --mcp', { tools: tools.length, listAgentsHasJuniper: listed.includes(agent.id) })
  if (!tools.includes('list_agents') || !listed.includes(agent.id)) throw new Error(`the MCP bridge answered ${out.slice(0, 500)}`)
}

function launch() {
  const proc = spawn(exe, [`--remote-debugging-port=${cdpPort}`], { env, stdio: 'ignore' })
  proc.on('exit', (code) => say('app process exited', { code }))
  return proc
}

async function quit() {
  const exited = new Promise((resolve) => child.once('exit', resolve))
  execFileSync('taskkill', ['/PID', String(child.pid)])
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
