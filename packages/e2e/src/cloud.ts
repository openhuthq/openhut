import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { CheckResult, PhaseResults } from './e2e.ts'

const RESULTS = process.env.RESULTS ?? 'packages/e2e/results'
const CLOUD = process.env.CLOUD_URL ?? 'http://127.0.0.1:8790'
const CLOUD_STATE = process.env.CLOUD_STATE ?? `${RESULTS}/cloud-state`
const REMOTE = process.env.REMOTE_URL ?? 'http://127.0.0.1:8787'
const REMOTE_KEY = process.env.OPENHUT_E2E_KEY ?? ''
const REMOTE_CONTAINER = process.env.REMOTE_CONTAINER
const HOST_PORT = Number(process.env.HOST_PORT ?? 8840)
const HOST = `http://127.0.0.1:${HOST_PORT}`
const SECRET = `e2e-${randomBytes(9).toString('hex')}`
const data = mkdtempSync(join(tmpdir(), 'openhut-e2e-host-'))
const results: CheckResult[] = []

const runtime = spawn(process.execPath, ['packages/runtime/src/server/app.ts'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env, PORT: String(HOST_PORT), OPENHUT_DATA: data, OPENHUT_CLOUD_URL: CLOUD, OPENHUT_MODEL: 'test', AGENTD_SOCK: join(data, 'no-agentd.sock'),
    OPENHUT_GATEWAY_PORT: String(HOST_PORT + 1), OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('host').digest('hex'),
  },
})
after(() => {
  runtime.kill()
  const passed = results.filter((r) => r.pass).length
  const report: PhaseResults = { phase: 'cloud', at: new Date().toISOString(), passed, failed: results.length - passed, results }
  writeFileSync(`${RESULTS}/e2e-cloud.json`, JSON.stringify(report, null, 2))
  console.log(`\n${passed}/${results.length} passed -> ${RESULTS}/e2e-cloud.json`)
})

const call = (base: string, key: string) => async (path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json)}`)
  return json ?? {}
}
const inContainer = (name: string) => async (path: string, body?: unknown) => {
  const json = body === undefined ? [] : ['-d', JSON.stringify(body)]
  const { stdout } = await promisify(execFile)('docker', ['exec', name, 'curl', '-s', '-w', '\n%{http_code}', '-H', `authorization: Bearer ${REMOTE_KEY}`, '-H', 'content-type: application/json', ...json, `${REMOTE}${path}`])
  const status = Number(stdout.slice(stdout.lastIndexOf('\n') + 1))
  const reply = JSON.parse(stdout.slice(0, stdout.lastIndexOf('\n')) || '{}') as Record<string, unknown>
  if (status < 200 || status > 299) throw new Error(`${path} answered ${status}: ${JSON.stringify(reply)}`)
  return reply
}
const host = call(HOST, 'host')
const remote = REMOTE_CONTAINER ? inContainer(REMOTE_CONTAINER) : call(REMOTE, REMOTE_KEY)

async function until<T>(read: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
  }
  throw new Error(`timed out waiting for ${what}`)
}

function check(id: string, name: string, expected: string, fn: () => Promise<string>) {
  test(`${id} ${name}`, async () => {
    try {
      results.push({ id, check: name, expected, actual: await fn(), pass: true })
    } catch (error) {
      results.push({ id, check: name, expected, actual: error instanceof Error ? error.message : String(error), pass: false })
      throw error
    }
  })
}

check('Y1', 'The Mac signs in to the cloud room', 'host runtime: cloud on, owner mo@example.com', async () => {
  await until(() => host('/api/cloud').then(() => true), 'the host runtime')
  const { authorizationUrl } = await host('/api/cloud/sessions', {}) as { authorizationUrl: string }
  let url = authorizationUrl
  for (let hop = 0; hop < 5 && !url.includes('/v1/dev/sign-in'); hop++) url = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location') ?? '', url).href
  const page = await (await fetch(url)).text()
  const link = /href="([^"]+)"/.exec(page)?.[1]?.replaceAll('&amp;', '&') ?? ''
  await fetch(link)
  const cloud = await until(async () => { const each = await host('/api/cloud'); return each.status === 'on' ? each : undefined }, 'the host cloud to be on')
  assert.equal(cloud.email, 'mo@example.com')
  return `status ${String(cloud.status)}, ${String(cloud.email)}`
})

check('Y2', 'The remote runtime joins as a device on the member list and signs in with its own key', 'remote cloud on; its device is on the list under mo@example.com', async () => {
  const before = await remote('/api/cloud') as { status: string; device: string }
  assert.equal(before.status, 'off')
  const invite = await host('/api/cloud/runtimes', { device: before.device })
  await remote('/api/cloud/join', invite)
  const cloud = await until(async () => { const each = await remote('/api/cloud') as { status: string; workspace: { members: { email: string; devices: string[] }[] } | null }; return each.status === 'on' ? each : undefined }, 'the remote to be on')
  const owner = cloud.workspace?.members.find((member) => member.devices.includes(before.device))
  assert.equal(owner?.email, 'mo@example.com')
  return `remote ${cloud.status}, listed under ${owner?.email}`
})

check('Y3', 'A connection added on the Mac reaches the remote runtime with its key', 'remote lists "Cloud Orders" with keyHere true', async () => {
  await host('/api/connections', { kind: 'postgres', name: 'Cloud Orders', dsn: `postgres://app:${SECRET}@db.invalid/orders` })
  const found = await until(async () => {
    const { data } = await remote('/api/connections') as { data: { name: string; keyHere: boolean }[] }
    return data.find((each) => each.name === 'Cloud Orders' && each.keyHere)
  }, 'the connection on the remote')
  return `${found.name}, keyHere ${found.keyHere}`
})

check('Y4', 'The room holds the connection only locked', 'the DSN password is in no byte of the cloud’s storage', async () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)])
  const all = files(CLOUD_STATE)
  const hits = all.filter((file) => readFileSync(file).includes(SECRET))
  assert.deepEqual(hits, [])
  return `${all.length} files, 0 hits`
})
