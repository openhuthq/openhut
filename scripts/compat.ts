import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [tree, url] = process.argv.slice(2)
if (!tree || !url) {
  console.error('usage: node scripts/compat.ts <repo tree whose app version to use> <runtime url, with the dev key>')
  process.exit(2)
}
const appVersion = JSON.parse(readFileSync(join(tree, 'packages/desktop/package.json'), 'utf8')).version

async function call({ path, method = 'GET', body }: { path: string; method?: string; body?: unknown }) {
  const res = await fetch(`${url}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: 'Bearer dev', 'openhut-app-version': appVersion, ...(body !== undefined && { 'content-type': 'application/json' }) } })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${json?.error?.message ?? ''}`)
  return json
}

function older({ version, than }: { version: string; than: string }): boolean {
  const [a, b] = [version, than].map((each) => each.split(/[.-]/).slice(0, 3).map(Number))
  const at = a.findIndex((part, index) => part !== b[index])
  return at >= 0 && a[at] < b[at]
}

const results: { check: string; pass: boolean; detail: string }[] = []
async function check(name: string, run: () => Promise<string>) {
  try {
    results.push({ check: name, pass: true, detail: await run() })
  } catch (error) {
    results.push({ check: name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

await check('the runtime answers and accepts this app', async () => {
  const admin = await call({ path: '/api/admin' })
  if (admin.minAppVersion && older({ version: appVersion, than: admin.minAppVersion })) throw new Error(`the runtime says app ${appVersion} is too old`)
  return `online, app ${appVersion}`
})
await check('agents list, create, change and stay listed', async () => {
  const before = (await call({ path: '/api/agents' })).data
  const made = await call({ path: '/api/agents', method: 'POST', body: { name: `Compat ${Date.now() % 100000}` } })
  await call({ path: `/api/agents/${made.id}`, method: 'PATCH', body: { instructions: '# Compat\nChecked across versions.' } })
  const after = (await call({ path: '/api/agents' })).data
  if (!after.some((agent: { id: string }) => agent.id === made.id)) throw new Error('the new agent is missing from the list')
  return `${before.length} → ${after.length} agents`
})
await check('connections list', async () => `${(await call({ path: '/api/connections' })).data.length} connections`)
await check('model providers list', async () => `${(await call({ path: '/api/providers' })).data.length} providers`)

for (const result of results) console.log(`${result.pass ? 'ok  ' : 'FAIL'} ${result.check}: ${result.detail}`)
process.exit(results.every((result) => result.pass) ? 0 : 1)
