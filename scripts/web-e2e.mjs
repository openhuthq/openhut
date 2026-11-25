import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const OUT = process.env.OUT ?? tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
const lines = (text, n) => text.split('\n').filter(Boolean).slice(0, n).join(' / ')

const browser = await chromium.launch({ channel: 'chrome' })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage()
const text = () => page.evaluate(() => document.body.innerText).catch(() => '')
const until = async (pattern, ms = 45000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text()).slice(0, 300)}`) }
const shot = async (name) => { await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' }); await sleep(500); await page.screenshot({ path: `${OUT}/${name}.png` }); log(`screenshot ${name}.png: ${lines(await text(), 3)}`) }

try {
  await page.goto(WEB)
  const shell = await until(/New agent|Make your first agent|Settings/i)
  if (/Continue with Google|Sign in to OpenHut/i.test(shell)) throw new Error('the app asked to sign in')
  log(`1 the shell renders with no sign-in: ${lines(shell, 4)}`)
  await shot('1-shell')
  const me = await page.evaluate(() => fetch('/api/me').then((r) => r.status))
  if (me !== 200) throw new Error(`/api/me through Vite's proxy answered ${me}`)
  log('2 /api/me answers 200 through the dev proxy')
  await page.goto(new URL('settings/computers', WEB).href)
  log(`3 Settings > Computers: ${lines(await until(/This computer/), 4)}`)
  await shot('2-computers')
  log('PASS')
} catch (error) {
  log(`FAIL ${error.message}`)
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
  process.exitCode = 1
}
await browser.close()
