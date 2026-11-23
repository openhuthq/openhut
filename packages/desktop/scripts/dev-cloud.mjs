import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export function devCloudUrl() {
  return `http://127.0.0.1:${8800 + Math.floor(Math.random() * 500)}`
}

export async function bootCloud({ dir, api }) {
  const proc = spawn(process.execPath, ['src/server.ts'], { cwd: resolve(dir), env: { ...process.env, PORT: new URL(api).port, API_URL: api, DEV_SIGN_IN: '1', DATABASE_URL: '', OPENHUT_API_DATA: '' }, stdio: ['ignore', 'ignore', 'inherit'] })
  await waitFor(async () => fetch(`${api}/v1/events`).then(() => true, () => null), 120, 'the dev cloud API to listen')
  return proc
}

export async function signIn({ page, api }) {
  const { authorizationUrl } = await page.eval("fetch('/api/cloud/sessions', { method: 'POST' }).then((r) => r.json())")
  const link = new RegExp('href="([^"]+)">mo@example.com<').exec(await (await fetch(authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error('the dev sign-in page has no link for mo@example.com')
  const back = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location') ?? '', api)
  await page.eval(`fetch(${JSON.stringify(`/api/cloud/callback${back.search}`)}).then((r) => r.text())`)
  await waitFor(async () => (await page.eval("fetch('/api/cloud').then((r) => r.json())")).status === 'on' || null, 120, 'the cloud to say signed in')
  const kit = await page.eval("fetch('/api/cloud/kits', { method: 'POST' }).then((r) => r.status)")
  if (kit !== 200) throw new Error(`saving the recovery kit answered ${kit}`)
}

async function waitFor(check, seconds, what) {
  const end = Date.now() + seconds * 1000
  for (;;) {
    const result = await check().catch(() => null)
    if (result) return result
    if (Date.now() > end) throw new Error(`timed out after ${seconds}s waiting for ${what}`)
    await sleep(1000)
  }
}
