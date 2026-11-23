import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { packAgentBrowser, packHermes } from './pack-hermes.mjs'

const ROOT = join(import.meta.dirname, '../../..')
const OUT = join(import.meta.dirname, '../dist/backend')
const NATIVE = ['@electric-sql/pglite']

rmSync(OUT, { recursive: true, force: true })

const bundle = (entry, outfile, options = {}) => build({
  entryPoints: [join(ROOT, entry)], outfile: join(OUT, outfile), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: [...NATIVE, 'pg-native'], alias: { 'sodium-native': 'sodium-javascript' }, logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { dirname as __dn } from 'node:path'; import { fileURLToPath as __fu } from 'node:url'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
  ...options,
})

mkdirSync(join(OUT, 'node_modules'), { recursive: true })
writeFileSync(join(OUT, 'INSTALL_URL'), `${process.env.OPENHUT_INSTALL_URL || 'https://openhut.dev/edge'}\n`)
await bundle('packages/runtime/src/agentd/agentd.ts', 'packages/runtime/src/agentd/agentd.mjs')
await bundle('packages/runtime/src/server/app.ts', 'packages/runtime/src/server/platform/app.mjs')
writeFileSync(join(OUT, 'BUILD'), `${JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version}-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()}\n`)
writeFileSync(join(OUT, 'packages/runtime/package.json'), JSON.stringify({ version: JSON.parse(readFileSync(join(ROOT, 'packages/runtime/package.json'), 'utf8')).version }))
for (const path of ['install/agent-image', 'install/agent-browser', 'install/native-runtime.json', 'vendor/hermes-plugins']) cpSync(join(ROOT, path), join(OUT, path), { recursive: true })
for (const name of NATIVE) cpSync(join(ROOT, 'node_modules', name), join(OUT, 'node_modules', name), { recursive: true, dereference: true })
await packHermes(join(OUT, 'runtime'))
await packAgentBrowser(join(OUT, 'bin/native'))

