import { readFileSync, writeFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`usage: node scripts/set-version.ts <version like 0.6.3 or v0.6.3>, got "${process.argv[2] ?? ''}"`)
  process.exit(2)
}

type Manifest = { version: string; packages: Record<string, { version: string }> }

function edit(file: string, change: (json: Manifest) => void) {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Manifest
  change(json)
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}

edit('packages/desktop/package.json', (p) => { p.version = version })
edit('packages/runtime/package.json', (p) => { p.version = version })
edit('package-lock.json', (l) => {
  l.packages['packages/desktop'].version = version
  l.packages['packages/runtime'].version = version
})
console.log(`The app and runtime are ${version} in this checkout.`)
