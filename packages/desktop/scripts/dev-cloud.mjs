import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export function devCloudUrl() {
  return `http://127.0.0.1:${8800 + Math.floor(Math.random() * 500)}`
}

export async function bootCloud({ dir, api, log, data = '' }) {
  const proc = spawn(process.execPath, ['src/server.ts'], { cwd: resolve(dir), env: { ...process.env, PORT: new URL(api).port, API_URL: api, DEV_SIGN_IN: '1', DATABASE_URL: '', OPENHUT_API_DATA: data }, stdio: ['ignore', log ? 'pipe' : 'ignore', 'inherit'] })
  if (log) {
    mkdirSync(dirname(log), { recursive: true })
    proc.stdout.pipe(createWriteStream(log, { flags: 'a' }))
  }
  await waitFor(async () => fetch(`${api}/health`).then(() => true, () => null), 120, 'the dev cloud API to listen')
  return proc
}

export async function signIn({ page, api, email = 'mo@example.com' }) {
  const { authorizationUrl } = await page.eval("openhutFetch('/api/cloud/sessions', { method: 'POST' }).then((r) => r.json())")
  const link = new RegExp(`href="([^"]+)">${email.replaceAll('.', '\\.')}<`).exec(await (await fetch(authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error(`the dev sign-in page has no link for ${email}`)
  const back = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location') ?? '', api)
  const callback = await fetch(new URL(back.searchParams.get('to') ?? back))
  if (!callback.ok) throw new Error(`the runtime's sign-in callback at ${back.searchParams.get('to') ?? back} answered ${callback.status}`)
  let last
  await waitFor(async () => (last = await page.eval("openhutFetch('/api/cloud').then((r) => r.json())")).status === 'on' || null, 120, 'the cloud to say signed in')
    .catch((error) => { throw new Error(`${error.message}; /api/cloud last said ${JSON.stringify(last).slice(0, 400)}`) })
  await waitFor(async () => (await page.eval("openhutFetch('/api/agents').then((r) => r.status)")) === 200 || null, 120, 'the window to join its runtime and reach it through the relay')
  const kit = await page.eval("openhutFetch('/api/cloud/kits', { method: 'POST' }).then((r) => r.status)")
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
