import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export function devCloudUrl() {
  return `http://127.0.0.1:${8800 + Math.floor(Math.random() * 500)}`
}

export async function bootCloud({ dir, api, log }) {
  const proc = spawn(process.execPath, ['src/server.ts'], { cwd: resolve(dir), env: { ...process.env, PORT: new URL(api).port, API_URL: api, DEV_SIGN_IN: '1', DATABASE_URL: '', OPENHUT_API_DATA: '' }, stdio: ['ignore', log ? 'pipe' : 'ignore', 'inherit'] })
  if (log) {
    mkdirSync(dirname(log), { recursive: true })
    proc.stdout.pipe(createWriteStream(log))
  }
  await waitFor(async () => fetch(`${api}/v1/events`).then(() => true, () => null), 120, 'the dev cloud API to listen')
  return proc
}

export async function bootWorker({ dir, url, state, log }) {
  const wrangler = join(resolve(dir), 'node_modules/wrangler/bin/wrangler.js')
  const options = { cwd: resolve(dir), env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } }
  const migrated = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'openhut-stats', '--local', '--persist-to', state], { ...options, encoding: 'utf8' })
  if (migrated.status !== 0) throw new Error(`the dev Worker's D1 migrations failed: ${migrated.stdout}${migrated.stderr}`)
  const vars = ['DEV_SIGN_IN:1', 'GOOGLE_CLIENT_ID:dev', 'GOOGLE_CLIENT_SECRET:dev', 'STATE_KEY:dev-state-key', 'BETTER_AUTH_SECRET:dev-better-auth-secret-0123456789abcdef', `AUTH_URL:${url}`]
  const proc = spawn(process.execPath, [wrangler, 'dev', '--infer-origin-from-routes=false', ...vars.flatMap((each) => ['--var', each]), '--port', new URL(url).port, '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session=false', '--log-level', 'warn'], { ...options, stdio: ['ignore', log ? 'pipe' : 'ignore', log ? 'pipe' : 'inherit'] })
  if (log) {
    mkdirSync(dirname(log), { recursive: true })
    const out = createWriteStream(log)
    proc.stdout.pipe(out)
    proc.stderr.pipe(out)
  }
  await waitFor(async () => fetch(url).then(() => true, () => null), 120, 'the dev cloud Worker (relay) to listen')
  return proc
}

export async function signIn({ page, api, email = 'mo@example.com', kit = true }) {
  const { authorizationUrl } = await page.eval("fetch('/api/cloud/sessions', { method: 'POST' }).then((r) => r.json())")
  const link = new RegExp(`href="([^"]+)">${email.replaceAll('.', '\\.')}<`).exec(await (await fetch(authorizationUrl)).text())?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error(`the dev sign-in page has no link for ${email}`)
  const back = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location') ?? '', api)
  await page.eval(`fetch(${JSON.stringify(`/api/cloud/callback${back.search}`)}).then((r) => r.text())`)
  let last
  await waitFor(async () => (last = await page.eval("fetch('/api/cloud').then((r) => r.json())")).status === 'on' || null, 120, 'the cloud to say signed in')
    .catch((error) => { throw new Error(`${error.message}; /api/cloud last said ${JSON.stringify(last).slice(0, 400)}`) })
  if (!kit) return
  const saved = await page.eval("fetch('/api/cloud/kits', { method: 'POST' }).then((r) => r.status)")
  if (saved !== 200) throw new Error(`saving the recovery kit answered ${saved}`)
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
