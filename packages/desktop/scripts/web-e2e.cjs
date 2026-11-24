const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const OUT = process.env.OUT ?? require('node:os').tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5190/'
const RUNTIME = process.env.RUNTIME ?? 'http://127.0.0.1:8798'
const MAC = process.env.MAC ?? 'http://localhost:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); require('node:fs').appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { partition: `e2e-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const text = () => win.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  const shot = async (name) => { await win.webContents.insertCSS("*,*::before,*::after{animation:none!important;transition:none!important}"); win.setSize(1280, 821); await sleep(300); win.setSize(1280, 820); await sleep(500); writeFileSync(`${OUT}/${name}.png`, (await win.webContents.capturePage()).toPNG()); log(`screenshot ${name}.png: ${(await text()).split("\n").filter(Boolean).slice(0, 3).join(" / ")}`) }
  const until = async (pattern, ms = 30000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text()).slice(0, 300)}`) }
  try {
    await macSignedIn()
    await win.loadURL(WEB)
    log(`1 open ${WEB}: ${(await until(/Your agents, everywhere/)).split('\n').slice(0, 2).join(' / ')}`)
    await shot('1-sign-in')
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Continue with Google')).click()`)
    await until(/mo@example.com/)
    log(`2 cloud dev sign-in page at ${win.webContents.getURL().split('?')[0]}`)
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('a')].find((a) => a.innerText.trim() === 'mo@example.com').click()`)
    const knocking = await until(/Knock knock\.[\s\S]*Use another account/)
    const pair = knocking.split('\n').map((line) => line.trim()).filter((line) => /^[A-Z][a-z]+$/.test(line)).slice(0, 2)
    log(`3 the browser knocks and shows ${pair.join(' and ')}`)
    await shot('2-knocking')
    const keys = await win.webContents.executeJavaScript(`new Promise((done) => { const o = indexedDB.open('openhut'); o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').get('keys'); r.onsuccess = () => done({ signing: r.result.signing.privateKey.extractable, tunnel: r.result.tunnel.privateKey.extractable, algorithm: r.result.tunnel.privateKey.algorithm.name }) } })`)
    log(`4 browser keys in IndexedDB: ${JSON.stringify(keys)}`)
    const mac = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { partition: `mac-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    const macText = () => mac.webContents.executeJavaScript('document.body.innerText').catch(() => '')
    const macClick = (selector, label) => mac.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => (each.getAttribute('aria-label') ?? each.innerText).trim() === ${JSON.stringify(label)}); b?.click(); return Boolean(b) })()`)
    const macUntil = async (pattern, ms = 45000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await macText(); if (pattern.test(t)) return t } throw new Error(`the Mac never showed ${pattern}; it says: ${(await macText()).slice(0, 300)}`) }
    await mac.loadURL(MAC)
    log(`5 the Mac: ${(await macUntil(/knocking/)).split('\n').find((line) => /knocking/.test(line))}`)
    await macClick('button', 'Let it in')
    await macUntil(/Which pair is on the new screen\?/)
    let pairs = []
    for (const end = Date.now() + 30000; pairs.length < 3 && Date.now() < end; await sleep(300)) pairs = await mac.webContents.executeJavaScript(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].map((b) => b.getAttribute('aria-label'))`)
    log(`6 the Mac asks which pair: ${pairs.join(' | ')}`)
    if (!await macClick('button[aria-pressed]', pair.join(' and '))) throw new Error(`the Mac doesn't offer ${pair.join(' and ')}`)
    await sleep(800)
    writeFileSync(`${OUT}/2b-mac-pick-pair.png`, (await mac.webContents.capturePage()).toPNG())
    await macClick('button', (await macText()).includes('Touch ID to let it in') ? 'Touch ID to let it in' : 'Let it in')
    log('7 the Mac picks the pair and lets it in')
    await until(/You’re in\./, 45000)
    await shot('2c-youre-in')
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Open OpenHut').click()`)
    log(`8 the Mac: ${(await macUntil(/joined/)).split('\n').find((line) => /joined/.test(line))}`)
    await sleep(800)
    writeFileSync(`${OUT}/2d-mac-joined.png`, (await mac.webContents.capturePage()).toPNG())
    const ready = await until(/Make your first agent|New agent|\nApps\n/i, 45000)
    log(`9 dashboard over the tunnel: ${ready.split('\n').filter(Boolean).slice(0, 6).join(' / ')}`)
    await sleep(1500)
    await shot('3-dashboard-over-tunnel')
    const me = await win.webContents.executeJavaScript(`fetch('/api/me').then((r) => r.status).catch(() => 'no local server')`)
    log(`10 the page's own origin has no runtime (/api/me there: ${me}); data came through the tunnel`)
    log('PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    await shot('failure').catch(() => {})
    process.exitCode = 1
  }
  app.exit(process.exitCode ?? 0)
})

// A fresh runtime (CI) signs the Mac in to the dev cloud as mo@example.com and saves its kit, as dev-cloud.mjs signIn does through a page.
async function macSignedIn() {
  const api = (path, init) => fetch(`${RUNTIME}${path}`, { ...init, headers: { authorization: 'Bearer dev', ...init?.headers } })
  if ((await (await api('/api/cloud')).json()).status === 'on') return
  const { authorizationUrl } = await (await api('/api/cloud/sessions', { method: 'POST' })).json()
  const link = /href="([^"]+)">mo@example\.com</.exec(await (await fetch(authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error('the dev sign-in page has no link for mo@example.com')
  const back = new URL((await fetch(new URL(link, authorizationUrl), { redirect: 'manual' })).headers.get('location') ?? '', authorizationUrl)
  await api(`/api/cloud/callback${back.search}`)
  for (const end = Date.now() + 60000; (await (await api('/api/cloud')).json()).status !== 'on'; await sleep(1000)) if (Date.now() > end) throw new Error('the Mac never signed in')
  const kit = await api('/api/cloud/kits', { method: 'POST' })
  if (kit.status !== 200) throw new Error(`saving the Mac's kit answered ${kit.status}`)
  log('0 the Mac signed in to the dev cloud and saved its kit')
}
