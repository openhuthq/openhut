const { app, BrowserWindow } = require('electron')
const { appendFileSync, writeFileSync } = require('node:fs')
const OUT = process.env.OUT ?? require('node:os').tmpdir()
const MAC = process.env.MAC ?? 'http://localhost:5173/'
const NEW = process.env.NEW ?? 'http://localhost:5190/'
const NEW_RUNTIME = process.env.NEW_RUNTIME ?? 'http://127.0.0.1:8799'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
const NAMES = ['Tilly', 'Moss', 'Bea', 'Duke', 'Sunny', 'Nibs', 'Wally', 'Sprig', 'Pip', 'Fig', 'Ziggy', 'Rosie']

app.whenReady().then(async () => {
  const open = (url) => {
    const win = new BrowserWindow({ width: 1180, height: 728, show: false, webPreferences: { partition: `knock-${Math.random()}`, sandbox: true, contextIsolation: true } })
    void win.loadURL(url)
    return win
  }
  const text = (win) => win.webContents.executeJavaScript('document.body.innerText').catch(() => '')
  const until = async (win, pattern, ms = 30000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(win); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text(win)).slice(0, 300)}`) }
  const click = (win, selector, label) => win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => (each.getAttribute('aria-label') ?? each.innerText).trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  const shot = async (win, name) => { await win.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}'); await sleep(700); writeFileSync(`${OUT}/${name}.jpg`, (await win.webContents.capturePage()).toJPEG(88)); log(`screenshot ${name}.jpg`) }
  try {
    const knocker = open(NEW)
    await until(knocker, /Ask my other computer|Knock knock/)
    await click(knocker, 'button', 'Ask my other computer')
    let asked
    for (const end = Date.now() + 30000; !asked?.faces && Date.now() < end; await sleep(300)) asked = (await (await fetch(`${NEW_RUNTIME}/api/cloud`, { headers: { authorization: 'Bearer dev' } })).json()).asking
    const pair = asked.faces.map((index) => NAMES[index])
    const knocking = await until(knocker, new RegExp(`Knock knock\\.[\\s\\S]*${pair[0]}[\\s\\S]*${pair[1]}`))
    log(`1 new device knocks and shows ${pair.join(' and ')}: ${knocking.split('\n').filter(Boolean).slice(1, 6).join(' / ')}`)
    await shot(knocker, 'c-01-knocking')

    const mac = open(MAC)
    await until(mac, /knocking/, 45000)
    log(`2 the Mac shows the knock: ${(await text(mac)).split('\n').filter((line) => /knocking/.test(line))[0]}`)
    await click(mac, 'button', 'Let it in')
    await until(mac, /Which pair is on the new screen\?/)
    let pairs = []
    for (const end = Date.now() + 30000; pairs.length < 3 && Date.now() < end; await sleep(300)) pairs = await mac.webContents.executeJavaScript(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].map((b) => b.getAttribute('aria-label'))`)
    log(`3 the Mac asks which pair: ${pairs.join(' | ')}`)
    await click(mac, 'button[aria-pressed]', pair.join(' and '))
    await shot(mac, 'c-02-pick-pair')
    await click(mac, 'button', (await text(mac)).includes('Touch ID to let it in') ? 'Touch ID to let it in' : 'Let it in')
    log('4 picked the pair and let it in')

    await until(mac, /joined/, 45000)
    log(`6 the Mac: ${(await text(mac)).split('\n').filter((line) => /joined/.test(line))[0]}`)
    await shot(mac, 'c-04-joined-toast')
    await until(knocker, /Make your first agent|New agent|\nApps\n/i, 45000)
    log('7 new device opens the dashboard')
    await shot(knocker, 'c-05-new-device-dashboard')
    log('PASS')
  } catch (error) {
    log(`FAIL ${error.message}`)
    for (const win of BrowserWindow.getAllWindows()) log(`toasts in window ${win.id}: ${await win.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent))`)}`)
    for (const win of BrowserWindow.getAllWindows()) writeFileSync(`${OUT}/failure-${win.id}.jpg`, (await win.webContents.capturePage()).toJPEG(80))
    process.exitCode = 1
  }
  app.exit(process.exitCode ?? 0)
})
