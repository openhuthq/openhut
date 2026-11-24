const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const OUT = process.env.OUT ?? tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5191/'
const CLOUD = process.env.CLOUD ?? 'http://127.0.0.1:8892'
const SERVER_PORT = process.env.SERVER_PORT ?? '8899'
const ROOT = resolve(__dirname, '../../..')
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
const children = []

function page({ width = 1180, height = 760, userAgent } = {}) {
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { partition: `first-run-${Date.now()}-${Math.random()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  if (userAgent) win.webContents.setUserAgent(userAgent)
  win.webContents.setWindowOpenHandler(({ url }) => { log(`  (the page opened ${url}; not followed)`); return { action: 'deny' } })
  const text = () => win.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  const run = (code) => win.webContents.executeJavaScript(code)
  const click = async (label, selector = 'button, a') => {
    const found = await run(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.innerText.trim() === ${JSON.stringify(label)}); b?.click(); return Boolean(b) })()`)
    if (!found) throw new Error(`no ${label} on the page; it says: ${(await text()).slice(0, 300)}`)
  }
  const until = async (pattern, ms = 30000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text()).slice(0, 300)}`) }
  const shot = async (name) => {
    await win.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}')
    const [w, h] = win.getSize()
    win.setSize(w, h + 1); await sleep(300); win.setSize(w, h); await sleep(600)
    writeFileSync(`${OUT}/${name}.jpg`, (await win.webContents.capturePage()).toJPEG(88))
    log(`  screenshot ${name}.jpg: ${(await text()).split('\n').filter(Boolean).slice(0, 4).join(' / ')}`)
  }
  const signIn = async (email) => {
    await win.loadURL(WEB)
    await until(/Use OpenHut in your browser/)
    await click('Continue with Google')
    await until(new RegExp(email.replace('.', '\\.')))
    await click(email, 'a')
  }
  return { win, text, run, click, until, shot, signIn }
}

function server(code, data) {
  const env = { ...process.env, PORT: SERVER_PORT, OPENHUT_GATEWAY_PORT: String(Number(SERVER_PORT) + 100), OPENHUT_DATA: data, AGENTD_SOCK: join(data, 'agentd.sock'), OPENHUT_CLOUD_URL: CLOUD, OPENHUT_API_URL: CLOUD, OPENHUT_NAME: 'e2e-server', OPENHUT_MODEL: 'test', ...code && { OPENHUT_JOIN: code } }
  for (const name of ['OPENHUT_SOCKET', 'OPENHUT_PERSONAL', 'ELECTRON_RUN_AS_NODE']) delete env[name]
  const agentd = spawn('node', ['packages/runtime/src/agentd/agentd.ts'], { cwd: ROOT, env: { ...env, OPENHUT_SANDBOX: 'native', AGENTD_DATA: join(data, 'agentd') }, stdio: ['ignore', 'ignore', 'inherit'] })
  const runtime = spawn('node', ['packages/runtime/src/server/app.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] })
  runtime.stdout.on('data', (chunk) => { for (const line of String(chunk).split('\n')) if (/first_computer|maker_let_in|join_failed|relay\.on|app\.started/.test(line)) log(`  server: ${line.slice(0, 220)}`) })
  children.push(agentd, runtime)
  return { stop: async () => { runtime.kill('SIGTERM'); agentd.kill('SIGTERM'); await sleep(1500) } }
}

app.whenReady().then(async () => {
  const data = mkdtempSync(join(tmpdir(), 'openhut-first-run-'))
  try {
    const web = page()
    await web.win.loadURL(WEB)
    log(`1 open ${WEB}: ${(await web.until(/Use OpenHut in your browser/)).split('\n').slice(0, 2).join(' / ')}`)
    await web.shot('w-01-sign-in')
    await web.signIn('sara@example.com')
    const choose = await web.until(/Where should your agents live\?/)
    const nothing = !/agent named|Agents\n|Chats|Settings|Team/.test(choose)
    log(`2 a fresh account with no computer sees the choice and nothing of its own (${nothing ? 'no agents, chats, team or settings on the page' : 'FOUND DATA'}): ${choose.replace(/\n+/g, ' / ')}`)
    if (!nothing) throw new Error('the first-run screen shows account data')
    await web.shot('w-02-choose')

    await web.click('Download for Mac')
    await web.until(/Waiting for your computer…/)
    log('3 Download for Mac starts the download and waits for the Mac')
    await web.shot('w-04-waiting')
    await web.win.reload()
    await web.until(/Welcome back\./)
    log('4 closing the tab and coming back resumes at the same step: Welcome back.')
    await web.shot('w-11-resume')
    await web.click('Pick another way')
    await web.until(/Where should your agents live\?/)

    await web.click('Run on my server')
    const first = (await web.until(/OPENHUT_JOIN='[^']+'/)).match(/OPENHUT_JOIN='([^']+)'/)[1]
    log(`5 Run on my server shows the command with a one-use code ${first.slice(0, 6)}…`)
    await web.shot('w-05-server')
    await web.win.reload()
    const resumed = (await web.until(/OPENHUT_JOIN='[^']+'/)).match(/OPENHUT_JOIN='([^']+)'/)[1]
    log(`6 after a reload the same command is back (${resumed === first ? 'same code' : 'A DIFFERENT CODE'})`)
    if (resumed !== first) throw new Error('the server step didn’t resume with its code')
    await web.run(`localStorage.setItem('openhut-first-run', JSON.stringify({ step: 'server', code: ${JSON.stringify(first)}, expiresAt: new Date(Date.now() - 1000).toISOString() }))`)
    await web.win.reload()
    await web.until(/Didn't hear from it/)
    log('7 a command past its 10 minutes shows Didn’t hear from it with Make a new command')
    await web.shot('w-12-server-expired')
    await web.click('Make a new command')
    const code = (await web.until(/OPENHUT_JOIN='[^']+'/)).match(/OPENHUT_JOIN='([^']+)'/)[1]
    log(`8 Make a new command issues a fresh code (${code !== first ? 'new' : 'THE SAME'}: ${code.slice(0, 6)}…)`)
    if (code === first) throw new Error('Make a new command reused the old code')

    const box = server(code, data)
    log(`9 the server runs the command: a runtime in server mode with OPENHUT_JOIN, cloud ${CLOUD}`)
    const knocking = await web.until(/Knock knock\.[\s\S]*Focus mode/, 90000)
    const pair = knocking.split('\n').map((line) => line.trim()).filter((line) => /^[A-Z][a-z]+$/.test(line)).slice(0, 2)
    log(`10 the waiting page moved on by itself when the server joined, and knocks with ${pair.join(' and ')}`)
    await web.shot('w-06-knock')
    await web.until(/You’re in\./, 90000)
    log('11 the server let in the browser that made its code: You’re in.')
    await web.shot('w-09-youre-in')
    await web.click('Open OpenHut')
    const opened = await web.until(/Make your first agent|New agent|Save your recovery kit|Finish on your computer|recovery kit/i, 60000)
    log(`12 OpenHut over the tunnel: ${opened.split('\n').filter(Boolean).slice(0, 5).join(' / ')}`)
    await web.shot('w-10-first-agent')

    const phone = page({ width: 390, height: 844, userAgent: IPHONE })
    await phone.signIn('ana@example.com')
    log(`13 a phone with no computer on its account: ${(await phone.until(/Set up on a computer\./)).replace(/\n+/g, ' / ')}`)
    await phone.shot('w-13-phone')
    phone.win.destroy()

    await box.stop()
    await web.win.reload()
    const offline = await web.until(/Your computer is offline\./, 60000)
    log(`14 with its only computer stopped, the account sees: ${offline.replace(/\n+/g, ' / ')}`)
    if (/Where should your agents live/.test(offline)) throw new Error('an offline computer showed the first-run screen')
    await web.shot('w-14-offline')
    server(undefined, data)
    const back = await web.until(/Make your first agent|New agent|Save your recovery kit|Finish on your computer|recovery kit/i, 90000)
    log(`15 the server came back and the page moved on by itself: ${back.split('\n').filter(Boolean).slice(0, 3).join(' / ')}`)
    log('PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    process.exitCode = 1
  }
  for (const child of children) child.kill('SIGTERM')
  await sleep(800)
  if (existsSync(data)) rmSync(data, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
