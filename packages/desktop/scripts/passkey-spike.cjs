const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const http = require('node:http')

const PAGE = `<!doctype html><meta charset="utf-8"><title>WebAuthn spike</title><body style="font:14px system-ui;padding:20px"><h2>Electron ${process.versions.electron} WebAuthn spike (${process.platform})</h2><pre id="out">running…</pre>
<script>
const out = document.getElementById('out'); const lines = []; const say = (l) => { lines.push(l); out.textContent = lines.join('\\n') }
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n))
const race = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out after ' + ms + 'ms (no prompt answered)')), ms))])
;(async () => {
  say('PublicKeyCredential: ' + typeof PublicKeyCredential)
  say('isUserVerifyingPlatformAuthenticatorAvailable: ' + await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch((e) => 'error ' + e.message))
  if (PublicKeyCredential.getClientCapabilities) say('getClientCapabilities: ' + JSON.stringify(await PublicKeyCredential.getClientCapabilities().catch((e) => 'error ' + e.message)))
  const t0 = Date.now()
  try {
    const made = await race(navigator.credentials.create({ publicKey: { rp: { id: 'localhost', name: 'spike' }, user: { id: rnd(16), name: 'spike', displayName: 'spike' }, challenge: rnd(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }, extensions: { prf: {} }, timeout: 8000 } }), 10000)
    say('create(platform): OK ' + made.type + ' prf=' + JSON.stringify(made.getClientExtensionResults().prf))
  } catch (e) { say('create(platform): ' + e.name + ': ' + e.message + ' after ' + (Date.now() - t0) + 'ms') }
  window.done = lines
})()
</script>`

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const win = new BrowserWindow({ width: 900, height: 420 })
  await win.loadURL(`http://localhost:${server.address().port}/`)
  let done
  for (let i = 0; i < 60 && !done; i++) {
    done = await win.webContents.executeJavaScript('window.done')
    if (!done) await new Promise((r) => setTimeout(r, 500))
  }
  writeFileSync(process.env.LOG ?? 'passkey-spike.txt', JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, results: done ?? 'no answer in 30s' }, null, 2))
  writeFileSync(process.env.SHOT ?? 'passkey-spike.jpg', (await win.webContents.capturePage()).toJPEG(85))
  app.quit()
})
