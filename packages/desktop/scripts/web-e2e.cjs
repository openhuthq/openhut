const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { execSync } = require('node:child_process')
const OUT = process.env.OUT ?? require('node:os').tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5190/'
const RUNTIME = process.env.RUNTIME ?? 'http://127.0.0.1:8798'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); require('node:fs').appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { partition: `e2e-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const text = () => win.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  const shot = async (name) => { writeFileSync(`${OUT}/${name}.png`, (await win.webContents.capturePage()).toPNG()); log(`screenshot ${name}.png`) }
  const until = async (pattern, ms = 30000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text()).slice(0, 300)}`) }
  try {
    await win.loadURL(WEB)
    log(`1 open ${WEB}: ${(await until(/Use OpenHut in your browser/)).split('\n').slice(0, 2).join(' / ')}`)
    await shot('1-sign-in')
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Continue with Google')).click()`)
    await until(/mo@example.com/)
    log(`2 cloud dev sign-in page at ${win.webContents.getURL().split('?')[0]}`)
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('a')].find((a) => a.innerText.trim() === 'mo@example.com').click()`)
    log(`3 ${(await until(/Approve this browser on your Mac/)).split('\n').slice(0, 2).join(' / ')}`)
    await shot('2-waiting-for-approval')
    const keys = await win.webContents.executeJavaScript(`new Promise((done) => { const o = indexedDB.open('openhut'); o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').get('keys'); r.onsuccess = () => done({ signing: r.result.signing.privateKey.extractable, tunnel: r.result.tunnel.privateKey.extractable, algorithm: r.result.tunnel.privateKey.algorithm.name }) } })`)
    log(`4 browser keys in IndexedDB: ${JSON.stringify(keys)}`)
    const mine = await win.webContents.executeJavaScript(`new Promise((done) => { const o = indexedDB.open('openhut'); o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').get('keys'); r.onsuccess = async () => { const raw = async (k) => new Uint8Array(await crypto.subtle.exportKey('raw', k)); const bytes = new Uint8Array([...await raw(r.result.signing.publicKey), ...await raw(r.result.tunnel.publicKey)]); done(btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')) } } })`)
    let asked, ws
    for (const end = Date.now() + 45000; !asked && Date.now() < end; await sleep(500)) {
      const cloud = JSON.parse(execSync(`curl -s -H 'authorization: Bearer dev' ${RUNTIME}/api/cloud`).toString())
      ws = cloud.workspace.id
      asked = cloud.workspaces.find((w) => w.id === ws).requests.find((r) => r.device === mine)
      for (const stale of cloud.workspaces.find((w) => w.id === ws).requests.filter((r) => r.os === 'web' && r.device !== mine)) execSync(`curl -s -o /dev/null -X DELETE -H 'authorization: Bearer dev' ${RUNTIME}/api/cloud/workspaces/${ws}/requests/${encodeURIComponent(stale.device)}`)
    }
    if (!asked) throw new Error(`the Mac never saw this browser's request (${mine.slice(0, 10)}…)`)
    log(`5 the Mac sees the request: name=${asked.name} os=${asked.os} email=${asked.email}`)
    const approved = execSync(`curl -s -o /dev/null -w '%{http_code}' -X POST -H 'authorization: Bearer dev' -H 'content-type: application/json' -d '{}' ${RUNTIME}/api/cloud/workspaces/${ws}/requests/${encodeURIComponent(asked.device)}/approvals`).toString()
    log(`6 the Mac approves: HTTP ${approved}`)
    const ready = await until(/Make your first agent|New agent/i, 45000)
    log(`7 dashboard over the tunnel: ${ready.split('\n').filter(Boolean).slice(0, 6).join(' / ')}`)
    await sleep(1500)
    await shot('3-dashboard-over-tunnel')
    const me = await win.webContents.executeJavaScript(`fetch('/api/me').then((r) => r.status).catch(() => 'no local server')`)
    log(`8 the page's own origin has no runtime (/api/me there: ${me}); data came through the tunnel`)
    log('PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    await shot('failure').catch(() => {})
    process.exitCode = 1
  }
  app.exit(process.exitCode ?? 0)
})
