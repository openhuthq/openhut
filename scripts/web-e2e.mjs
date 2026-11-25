// The browser run (R1, W1): a second browser and an invited teammate get in with no approval. scripts/web-e2e.sh starts the stack.
// Drives the system Chrome (ubuntu-latest has one) through playwright-core.
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const OUT = process.env.OUT ?? tmpdir()
const WEB = process.env.WEB ?? 'http://localhost:5190/'
const RUNTIME = process.env.RUNTIME ?? 'http://127.0.0.1:8797'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (line) => { console.log(line); appendFileSync(`${OUT}/evidence.log`, `${new Date().toISOString()} ${line}\n`) }
const lines = (text, n) => text.split('\n').filter(Boolean).slice(0, n).join(' / ')

const browser = await chromium.launch({ channel: 'chrome' })
const open = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage()
  const text = () => page.evaluate(() => document.body.innerText).catch(() => '')
  const until = async (pattern, ms = 45000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const t = await text(); if (pattern.test(t)) return t } throw new Error(`timed out waiting for ${pattern}; page says: ${(await text()).slice(0, 300)}`) }
  const shot = async (name) => { await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' }); await sleep(500); await page.screenshot({ path: `${OUT}/${name}.png` }); log(`screenshot ${name}.png: ${lines(await text(), 3)}`) }
  return { page, until, shot }
}

const me = await open()
try {
  await signedIn()
  await me.page.goto(WEB)
  log(`1 open ${WEB}: ${lines(await me.until(/Your agents, everywhere/), 2)}`)
  await me.shot('1-sign-in')
  await me.page.getByRole('button', { name: /Continue with Google/ }).click()
  await me.until(/mo@example.com/)
  log(`2 cloud dev sign-in page at ${me.page.url().split('?')[0]}`)
  await me.page.getByRole('link', { name: 'mo@example.com', exact: true }).click()
  const ready = await me.until(/Make your first agent|New agent|\nApps\n|Knock knock/i)
  if (/Knock knock/.test(ready)) throw new Error('the browser was asked to knock: a new account should start managed')
  log(`3 the second browser is in, no knock: ${lines(ready, 6)}`)
  const keys = await me.page.evaluate(() => new Promise((done) => { const o = indexedDB.open('openhut'); o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').get('keys'); r.onsuccess = () => done({ signing: r.result.signing.privateKey.extractable, tunnel: r.result.tunnel.privateKey.extractable, algorithm: r.result.tunnel.privateKey.algorithm.name }) } }))
  log(`4 browser keys in IndexedDB: ${JSON.stringify(keys)}`)
  await sleep(1500)
  await me.shot('w1-second-browser')
  const local = await me.page.evaluate(() => fetch('/api/me').then((r) => r.status).catch(() => 'no local server'))
  log(`5 the page's own origin has no runtime (/api/me there: ${local}); data came through the tunnel`)
  const workspace = (await (await api('/api/cloud')).json()).workspace.id
  const invite = await (await api('/api/invitations/cloud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace, email: 'ana@example.com', role: 'member' }) })).json()
  if (!invite.link) throw new Error(`inviting ana answered ${JSON.stringify(invite)}`)
  log('6 the owner invites ana@example.com')
  const ana = await open()
  await ana.page.goto(`${new URL('join', WEB)}${new URL(invite.link).hash}`)
  log(`7 ana opens the invite: ${lines(await ana.until(/Continue with Google/), 2)}`)
  await ana.page.getByRole('button', { name: /Continue with Google/ }).click()
  await ana.until(/Sign in \(dev only\)/)
  await ana.page.getByRole('link', { name: 'ana@example.com', exact: true }).click()
  const inTeam = await ana.until(/Nothing is shared with you yet|Shared with you|Knock knock|Tell /)
  if (/Knock knock|Tell /.test(inTeam)) throw new Error('the invited teammate was asked to knock: our servers should let her in')
  log(`8 the invited teammate is in, no owner step: ${lines(inTeam, 3)}`)
  await sleep(800)
  await ana.shot('w1-teammate-in')
  log('PASS')
} catch (error) {
  log(`FAIL ${error.message}`)
  for (const [i, context] of browser.contexts().entries()) await context.pages()[0]?.screenshot({ path: `${OUT}/failure-${i}.png` }).catch(() => {})
  process.exitCode = 1
}
await browser.close()

function api(path, init) {
  return fetch(`${RUNTIME}${path}`, { ...init, headers: { authorization: 'Bearer dev', ...init?.headers } })
}

// A fresh runtime (CI) signs its owner in to the dev cloud as mo@example.com.
async function signedIn() {
  if ((await (await api('/api/cloud')).json()).status === 'on') return
  const { authorizationUrl } = await (await api('/api/cloud/sessions', { method: 'POST' })).json()
  const link = /href="([^"]+)">mo@example\.com</.exec(await (await fetch(authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error('the dev sign-in page has no link for mo@example.com')
  const back = new URL((await fetch(new URL(link, authorizationUrl), { redirect: 'manual' })).headers.get('location') ?? '', authorizationUrl)
  await api(`/api/cloud/callback${back.search}`)
  for (const end = Date.now() + 60000; (await (await api('/api/cloud')).json()).status !== 'on'; await sleep(1000)) if (Date.now() > end) throw new Error('the runtime never signed in')
  log('0 the runtime signed in to the dev cloud')
}
