import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [tree, url] = process.argv.slice(2)
if (!tree || !url) {
  console.error('usage: node scripts/compat.ts <repo tree whose client to use> <runtime url, with the dev key>')
  process.exit(2)
}
const appVersion = JSON.parse(readFileSync(join(tree, 'packages/desktop/package.json'), 'utf8')).version
const { createOpenHut } = await import(pathToFileURL(join(tree, 'packages/client/src/openhut.ts')).href)
const local = { id: 'local', name: 'Runtime', url: '' }
const openhut = createOpenHut({
  transport: () => (path: string, init?: RequestInit) => fetch(`${url}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: 'Bearer dev', 'openhut-app-version': appVersion } }),
  store: { computers: async () => [local], add: async () => local, remove: async () => undefined },
  openUrl: () => undefined,
  appVersion,
})

const results: { check: string; pass: boolean; detail: string }[] = []
async function check(name: string, run: () => Promise<string>) {
  try {
    results.push({ check: name, pass: true, detail: await run() })
  } catch (error) {
    results.push({ check: name, pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

await check('the runtime answers and accepts this app', async () => {
  const [computer] = await openhut.computers.list()
  if (!computer?.online) throw new Error('the runtime looks offline to this client')
  if (computer.appTooOld) throw new Error(`the runtime says app ${appVersion} is too old`)
  if (computer.runtimeTooOld) throw new Error('this app says the runtime is too old')
  return `online, app ${appVersion}`
})
await check('agents list, create, change and stay listed', async () => {
  const before = await openhut.agents.list()
  const made = await openhut.agents.create({ computer: 'local', name: `Compat ${Date.now() % 100000}` })
  await openhut.agents.update({ id: made.id, change: { instructions: '# Compat\nChecked across versions.' } })
  const after = await openhut.agents.list()
  if (!after.some((agent: { id: string }) => agent.id === made.id)) throw new Error('the new agent is missing from the list')
  return `${before.length} → ${after.length} agents`
})
await check('connections list', async () => `${(await openhut.connections.list()).length} connections`)
await check('model providers list', async () => openhut.providers ? `${(await openhut.providers.list()).length} providers` : 'this client has none')

for (const result of results) console.log(`${result.pass ? 'ok  ' : 'FAIL'} ${result.check}: ${result.detail}`)
process.exit(results.every((result) => result.pass) ? 0 : 1)
