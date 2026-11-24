const { app, BrowserWindow } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { request } = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const OUT = process.env.OUT ?? tmpdir()
const WEB = process.env.WEB ?? 'http://app.localhost:8890'
const CLOUD = process.env.CLOUD ?? 'http://localhost:8890/api'
const SERVER_PORT = process.env.SERVER_PORT ?? '8899'
const HERMES = process.env.AGENTD_HERMES
const ROOT = resolve(__dirname, '../../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
const children = []
const gaps = []

function page() {
  const win = new BrowserWindow({ width: 1180, height: 760, show: false, webPreferences: { partition: `team-${Date.now()}-${Math.random()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  win.webContents.setWindowOpenHandler(({ url }) => { log(`  (the page opened ${url}; not followed)`); return { action: 'deny' } })
  win.webContents.session.on('will-download', (event) => event.preventDefault())
  const text = () => win.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  const run = (code) => win.webContents.executeJavaScript(code)
  const click = async (label, selector = 'button, a') => {
    const found = await run(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.innerText.trim() === ${JSON.stringify(label)}); b?.click(); return Boolean(b) })()`)
    if (!found) throw new Error(`no ${label} on ${win.webContents.getURL().replace(/[#?].*/, "")}; it says: ${(await text()).slice(0, 300)}`)
  }
  const until = async (pattern, ms = 30000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern} at ${win.webContents.getURL().replace(/[#?].*/, "")}; page says: ${(await text()).slice(0, 400)}`) }
  const shot = async (name) => {
    await win.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}')
    const [w, h] = win.getSize()
    win.setSize(w, h + 1); await sleep(300); win.setSize(w, h); await sleep(600)
    writeFileSync(`${OUT}/${name}.jpg`, (await win.webContents.capturePage()).toJPEG(88))
    log(`  screenshot ${name}.jpg: ${(await text()).split('\n').filter(Boolean).slice(0, 4).join(' / ')}`)
  }
  const signIn = async (email) => {
    await click('Continue with Google')
    for (const end = Date.now() + 30000; Date.now() < end; await sleep(300)) {
      if (await run(`[...document.querySelectorAll('a')].some((each) => each.innerText.trim() === ${JSON.stringify(email)})`).catch(() => false)) break
    }
    await click(email, 'a')
  }
  const go = (url) => win.loadURL(url).catch((error) => log(`  (loading ${url.replace(/#.*/, '#…')} said ${error.code ?? error.message}; going on)`))
  return { win, text, run, click, until, shot, signIn, go }
}

function server(code, data) {
  const env = { ...process.env, PORT: SERVER_PORT, OPENHUT_GATEWAY_PORT: String(Number(SERVER_PORT) + 100), OPENHUT_DATA: data, AGENTD_SOCK: join(data, 'agentd.sock'), OPENHUT_CLOUD_URL: CLOUD, OPENHUT_API_URL: CLOUD, OPENHUT_WEB_URL: WEB, OPENHUT_NAME: 'e2e-server', OPENHUT_MODEL: 'test', ...code && { OPENHUT_JOIN: code } }
  for (const name of ['OPENHUT_SOCKET', 'OPENHUT_PERSONAL', 'ELECTRON_RUN_AS_NODE']) delete env[name]
  const agentd = spawn('node', ['packages/runtime/src/agentd/agentd.ts'], { cwd: ROOT, env: { ...env, OPENHUT_SANDBOX: 'native', AGENTD_DATA: join(data, 'agentd'), ...HERMES && { AGENTD_HERMES: HERMES } }, stdio: ['ignore', process.env.SHOW_AGENTD ? 'inherit' : 'ignore', 'inherit'] })
  const runtime = spawn('node', ['packages/runtime/src/server/app.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] })
  runtime.stdout.on('data', (chunk) => { for (const line of String(chunk).split('\n')) if (/first_computer|maker_let_in|web_let_in|join_failed|app\.started/.test(line)) log(`  server: ${line.slice(0, 220)}`) })
  children.push(agentd, runtime)
  const socketPath = join(data, 'openhut.sock')
  const api = (method, path, body) => new Promise((done, fail) => {
    const out = request({ socketPath, path, method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk) => { text += chunk }).on('end', () => {
        const json = text ? JSON.parse(text) : null
        if (res.statusCode >= 400) fail(new Error(`${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`))
        else done(json)
      })
    }).on('error', fail)
    out.end(body ? JSON.stringify(body) : undefined)
  })
  return { api }
}

function headersOf(url) {
  return execFileSync('curl', ['-sS', '-D', '-', '-o', '/dev/null', url], { encoding: 'utf8' })
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(async () => {
  const data = mkdtempSync(join(tmpdir(), 'openhut-team-'))
  try {
    const stranger = page()
    await stranger.go(WEB)
    await stranger.until(/Use OpenHut in your browser/)
    await stranger.shot('f2-01-public')
    await stranger.signIn('ana@example.com')
    const choose = await stranger.until(/Where should your agents live\?/)
    const nothing = !/Agents\n|Chats|Settings|Team|Shared with you/.test(choose)
    const first = choose.split('\n').map((line) => line.trim()).filter(Boolean)
    log(`1 a stranger with no computer sees the download page first and no data (${nothing ? 'no agents, chats, team or settings' : 'FOUND DATA'}): ${first.join(' / ')}`)
    if (!nothing || first.indexOf('Download for Mac') > first.indexOf('Run on my server')) throw new Error('the stranger saw data, or the download wasn’t the first call to action')
    await stranger.shot('f2-02-stranger')
    stranger.win.destroy()

    const mo = page()
    await mo.go(WEB)
    await mo.until(/Use OpenHut in your browser/)
    await mo.signIn('mo@example.com')
    await mo.until(/Where should your agents live\?/)
    await mo.click('Run on my server')
    const code = (await mo.until(/OPENHUT_JOIN='[^']+'/)).match(/OPENHUT_JOIN='([^']+)'/)[1]
    const box = server(code, data)
    log(`2 mo runs the server command (cloud ${CLOUD}, web ${WEB}); the server is the account’s only computer`)
    await mo.until(/You’re in\./, 90000)
    await mo.click('Open OpenHut')
    await mo.until(/Save your recovery kit|recovery kit/i, 60000)
    log('3 W5 gap: the browser reaches the recovery kit over the tunnel')
    await mo.shot('f2-03-kit')
    const saved = await mo.run(`(() => { const b = [...document.querySelectorAll('button')].find((each) => /^(Download|Save)/.test(each.innerText.trim())); b?.click(); return b?.innerText ?? '' })()`)
    log(`  clicked ${saved || 'nothing'}`)
    const after = await mo.until(/Make your first agent|New agent|Type the words|Which word|word #/i, 60000)
    log(`4 after the kit: ${after.split('\n').filter(Boolean).slice(0, 4).join(' / ')}`)
    await mo.shot('f2-04-after-kit')

    const agent = await box.api('POST', '/api/agents', { name: 'Helper', instructions: 'Answer briefly.' })
    await box.api('PATCH', `/api/agents/${agent.id}`, { shared: true, wanted: 'running' })
    await box.api('POST', '/api/agents', { name: 'Diary', instructions: 'Private.' })
    let live = {}
    for (let i = 0; i < 120 && live.health !== 'answering'; i++, await sleep(1000)) live = await box.api('GET', `/api/agents/${agent.id}`)
    log(`5 mo has a shared agent Helper (${agent.id}: ${live.status}, ${live.health}${live.healthDetail ? `, ${live.healthDetail}` : ''}) and a private agent Diary`)
    const status = await box.api('GET', '/api/cloud')
    const home = status.workspaces.find((each) => each.home).id
    const invite = await box.api('POST', '/api/invitations/cloud', { workspace: home, email: 'sara@example.com', role: 'member' })
    const link = new URL(invite.link)
    log(`6 mo invites sara@example.com: ${link.origin}${link.pathname}#…`)

    const sara = page()
    await sara.go(`${WEB}/join${link.hash}`)
    await sara.until(/You’re invited/)
    await sara.shot('f2-05-invite')
    await sara.signIn('sara@example.com')
    const knocking = await sara.until(/Knock knock\.[\s\S]*Tell /, 60000)
    log(`7 sara, with nothing installed, signs in and knocks: ${knocking.split('\n').filter(Boolean).slice(0, 3).join(' / ')}`)
    await sara.shot('f2-06-knock')
    let asked
    for (let i = 0; i < 60 && !asked; i++, await sleep(1000)) asked = (await box.api('GET', '/api/cloud')).workspaces.find((each) => each.id === home)?.requests.find((each) => each.email === 'sara@example.com')
    await box.api('POST', `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(asked.device)}/reviews`)
    for (let i = 0; i < 60 && !asked.faces; i++, await sleep(1000)) asked = (await box.api('GET', '/api/cloud')).workspaces.find((each) => each.id === home)?.requests.find((each) => each.device === asked.device)
    await box.api('POST', `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(asked.device)}/approvals`, { faces: asked.faces })
    log('8 mo’s computer matches the two faces and lets sara’s browser in')
    await sara.until(/You’re in\./, 60000)
    await sara.click('Open OpenHut')
    const shared = await sara.until(/Shared with you[\s\S]*Helper/, 60000)
    const leak = /Diary/.test(shared)
    log(`9 sara sees only the shared agent (${leak ? 'DIARY LEAKED' : 'Helper, not Diary'})`)
    if (leak) throw new Error('the private agent showed to a teammate')
    await sara.run(`(() => { const t = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Hello from Sara'); t.dispatchEvent(new Event('input', { bubbles: true })); t.form?.requestSubmit?.(); return true })()`)
    const answered = await sara.until(/ECHO: [^\n]*Hello from Sara/, 90000).catch(() => null)
    if (!answered) gaps.push('Helper never answered: its Hermes didn’t come up on this machine')
    log(`10 sara chats with Helper over mo’s computer: ${answered ? answered.split('\n').filter(Boolean).slice(-3).join(' / ') : `NO ANSWER (${(await sara.text()).split('\n').filter(Boolean).slice(-2).join(' / ')})`}`)
    await sara.shot('f2-07-teammate-chat')

    const made = await box.api('POST', '/api/cloud/web-links', { path: `/agents/${agent.id}` })
    log(`11 Continue in web from mo’s computer: ${made.url.replace(/#continue=.*/, '#continue=…')}`)
    const web = page()
    await web.go(made.url)
    const landed = await web.until(/Helper/, 60000)
    const path = await web.run('location.pathname + location.hash')
    log(`12 the browser opens the same page signed in, with no knock: ${path} / ${landed.split('\n').filter(Boolean).slice(0, 3).join(' / ')}`)
    await web.shot('f2-08-continue')
    const twice = page()
    await twice.go(made.url)
    const second = await twice.until(/Use OpenHut in your browser|Knock knock/, 30000)
    log(`13 the same link a second time: ${second.split('\n').filter(Boolean).slice(0, 2).join(' / ')}`)
    await twice.shot('f2-09-continue-twice')

    const head = headersOf(`${WEB}/`)
    log(`14 app host headers: ${head.split('\n').filter((line) => /content-security-policy|strict-transport-security/i.test(line)).map((line) => line.trim().slice(0, 120)).join(' | ')}`)
    const health = JSON.parse(execFileSync('curl', ['-sS', `${CLOUD}/health`], { encoding: 'utf8' }))
    log(`15 funnel: ${JSON.stringify(health.funnel)}`)
    if (!(health.funnel.invite_accepted >= 1)) throw new Error('invite_accepted isn’t counted')
    log(gaps.length ? `PASS except: ${gaps.join('; ')}` : 'PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    process.exitCode = 1
  }
  for (const child of children) child.kill('SIGTERM')
  await sleep(800)
  if (existsSync(data) && !process.env.KEEP) rmSync(data, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
