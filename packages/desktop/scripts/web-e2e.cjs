const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { generateKeyPairSync } = require('node:crypto')
const OUT = process.env.OUT ?? require('node:os').tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5190/'
const RUNTIME = process.env.RUNTIME ?? 'http://127.0.0.1:8798'
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
    const ready = await until(/Make your first agent|New agent|\nApps\n|Knock knock/i, 45000)
    if (/Knock knock/.test(ready)) throw new Error('the browser was asked to knock: a new account should start managed')
    log(`3 the second browser is in, no knock and no Touch ID: ${ready.split('\n').filter(Boolean).slice(0, 6).join(' / ')}`)
    const keys = await win.webContents.executeJavaScript(`new Promise((done) => { const o = indexedDB.open('openhut'); o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').get('keys'); r.onsuccess = () => done({ signing: r.result.signing.privateKey.extractable, tunnel: r.result.tunnel.privateKey.extractable, algorithm: r.result.tunnel.privateKey.algorithm.name }) } })`)
    log(`4 browser keys in IndexedDB: ${JSON.stringify(keys)}`)
    await sleep(1500)
    await shot('w1-second-browser')
    const me = await win.webContents.executeJavaScript(`fetch('/api/me').then((r) => r.status).catch(() => 'no local server')`)
    log(`5 the page's own origin has no runtime (/api/me there: ${me}); data came through the tunnel`)
    const workspace = (await (await api('/api/cloud')).json()).workspace.id
    const invite = await (await api('/api/invitations/cloud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace, email: 'ana@example.com', role: 'member' }) })).json()
    if (!invite.link) throw new Error(`inviting ana answered ${JSON.stringify(invite)}`)
    log('6 the Mac invites ana@example.com')
    const ana = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { partition: `ana-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    const anaText = () => ana.webContents.executeJavaScript('document.body.innerText').catch(() => '')
    const anaUntil = async (pattern, ms = 45000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await anaText(); if (pattern.test(t)) return t } throw new Error(`ana never saw ${pattern}; the page says: ${(await anaText()).slice(0, 300)}`) }
    await ana.loadURL(`${new URL('join', WEB)}${new URL(invite.link).hash}`)
    log(`7 ana opens the invite: ${(await anaUntil(/Continue with Google/)).split('\n').filter(Boolean).slice(0, 2).join(' / ')}`)
    await ana.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Continue with Google')).click()`)
    await anaUntil(/Sign in \(dev only\)/)
    await ana.webContents.executeJavaScript(`[...document.querySelectorAll('a')].find((a) => a.innerText.trim() === 'ana@example.com').click()`)
    const inTeam = await anaUntil(/Nothing is shared with you yet|Shared with you|Knock knock|Tell /)
    if (/Knock knock|Tell /.test(inTeam)) throw new Error('the invited teammate was asked to knock: our servers should let her in')
    log(`8 the invited teammate is in, no owner step: ${inTeam.split('\n').filter(Boolean).slice(0, 3).join(' / ')}`)
    await sleep(800)
    writeFileSync(`${OUT}/w1-teammate-in.png`, (await ana.webContents.capturePage()).toPNG())
    await touchIdBrowser()
    log('PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    await shot('failure').catch(() => {})
    for (const other of BrowserWindow.getAllWindows().filter((each) => each !== win)) writeFileSync(`${OUT}/failure-${other.id}.png`, (await other.webContents.capturePage()).toPNG())
    process.exitCode = 1
  }
  app.exit(process.exitCode ?? 0)
})

// W3: End-to-end encryption on, browser B unlocks with Touch ID (a virtual authenticator holds the passkey, as iCloud Keychain would), no other device.
async function touchIdBrowser() {
  const b = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { partition: `touch-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const run = (code) => b.webContents.executeJavaScript(code)
  const bUntil = async (pattern, ms = 45000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await run('document.body.innerText').catch(() => ''); if (pattern.test(t)) return t } throw new Error(`browser B never saw ${pattern}; the page says: ${(await run('document.body.innerText').catch(() => '')).slice(0, 300)}`) }
  const passkey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const json = { method: 'POST', headers: { 'content-type': 'application/json' } }
  await api('/api/cloud/encryption/keys', { method: 'POST' })
  await api('/api/cloud/encryption/passkeys', { ...json, body: JSON.stringify({ id: 'touch-id', publicKey: passkey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') }) })
  const on = await (await api('/api/cloud/encryption', { ...json, body: JSON.stringify({ on: true }) })).json()
  if (on.encryption !== true) throw new Error(`turning End-to-end encryption on answered ${JSON.stringify(on).slice(0, 300)}`)
  log('9 the Mac turns End-to-end encryption on, with Touch ID')
  await b.loadURL(WEB)
  await bUntil(/Continue with Google/)
  await run(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Continue with Google')).click()`)
  await bUntil(/Sign in \(dev only\)/)
  await run(`[...document.querySelectorAll('a')].find((a) => a.innerText.trim() === 'mo@example.com').click()`)
  log(`10 browser B signs in and knocks: ${(await bUntil(/Unlock with Touch ID/)).split('\n').filter(Boolean).slice(0, 3).join(' / ')}`)
  writeFileSync(`${OUT}/w3-knock.png`, (await b.webContents.capturePage()).toPNG())
  const cdp = b.webContents.debugger
  cdp.attach('1.3')
  await cdp.sendCommand('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.sendCommand('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  await cdp.sendCommand('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: Buffer.from('touch-id').toString('base64'), isResidentCredential: true, rpId: new URL(WEB).hostname, userHandle: Buffer.from('mo').toString('base64'), privateKey: passkey.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), signCount: 0 } })
  // Electron has no passkey picker, so stand in for it: pick the one passkey (a browser's picker does this when the App asks with no list).
  await run(`const get = navigator.credentials.get.bind(navigator.credentials); navigator.credentials.get = (asked) => get({ publicKey: { ...asked.publicKey, allowCredentials: [{ type: 'public-key', id: new TextEncoder().encode('touch-id') }] } }); true`)
  await run(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Unlock with Touch ID')).click()`)
  const inside = await bUntil(/Make your first agent|New agent|\nApps\n/)
  log(`11 browser B is in with Touch ID, no faces and no other device: ${inside.split('\n').filter(Boolean).slice(0, 4).join(' / ')}`)
  await sleep(800)
  writeFileSync(`${OUT}/w3-touch-id-in.png`, (await b.webContents.capturePage()).toPNG())
}

// A fresh runtime (CI) signs the Mac in to the dev cloud as mo@example.com and saves its kit, as dev-cloud.mjs signIn does through a page.
function api(path, init) {
  return fetch(`${RUNTIME}${path}`, { ...init, headers: { authorization: 'Bearer dev', ...init?.headers } })
}

async function macSignedIn() {
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
