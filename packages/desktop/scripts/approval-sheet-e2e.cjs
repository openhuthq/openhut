// M0: the approval sheet shows the flag and location line, the amber note only for a first-time country, and the same buttons.
// node_modules/.bin/electron packages/desktop/scripts/approval-sheet-e2e.cjs  (OUT= for the screenshots)
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
const OUT = process.env.OUT ?? require('node:os').tmpdir()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const vite = await createServer({ configFile: resolve(__dirname, '../../app/vite.config.ts'), root: resolve(__dirname, 'approval-sheet'), server: { port: 0, fs: { allow: [resolve(__dirname, '../../..')] } }, logLevel: 'warn' })
  await vite.listen()
  const win = new BrowserWindow({ width: 760, height: 620, show: false })
  try {
    for (const [hash, name] of [['?away', 'approval-sheet-new-country'], ['?home', 'approval-sheet-home-country']]) {
      await win.loadURL(`${vite.resolvedUrls.local[0]}${hash}`)
      let text = ''
      for (const end = Date.now() + 30000; !/Which pair/.test(text) && Date.now() < end; await sleep(300)) text = await win.webContents.executeJavaScript('document.body.innerText')
      await sleep(800)
      const buttons = await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean)`)
      writeFileSync(`${OUT}/${name}.png`, (await win.webContents.capturePage()).toPNG())
      const away = hash === '?away'
      assert.match(text, away ? /🇫🇷 near Lyon, France · approximate/ : /🇬🇧 near London, United Kingdom · approximate/)
      assert.equal(/First request from this country/.test(text), away, away ? 'the amber note shows for a first-time country' : 'no amber note at home')
      assert.ok(buttons.includes('None of these: not me') && buttons.some((b) => /^(Touch ID to let it in|Let it in)$/.test(b)), `buttons: ${buttons.join(' | ')}`)
      console.log(`${name}: ${text.split('\n').filter(Boolean).join(' / ')}`)
    }
    console.log('PASS')
  } catch (error) {
    console.log(`FAIL ${error.message}`)
    process.exitCode = 1
  }
  await vite.close()
  app.exit(process.exitCode ?? 0)
})
