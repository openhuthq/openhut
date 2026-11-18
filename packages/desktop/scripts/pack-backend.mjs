import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../..')
const OUT = join(import.meta.dirname, '../dist/backend')
const LINUX = process.platform === 'linux'
const NATIVE = LINUX ? [] : ['@electric-sql/pglite', 'microsandbox', '@microsandbox/types', `@superradcompany/microsandbox-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`]

rmSync(OUT, { recursive: true, force: true })

const bundle = (entry, outfile) => build({
  entryPoints: [join(ROOT, entry)], outfile: join(OUT, outfile), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: [...NATIVE, 'pg-native'], logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { dirname as __dn } from 'node:path'; import { fileURLToPath as __fu } from 'node:url'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
})

await bundle('packages/client/src/openhut.ts', 'client.mjs')
cpSync(join(import.meta.dirname, '../bin/openhut-mcp'), join(OUT, 'bin/openhut-mcp'))
mkdirSync(join(OUT, 'node_modules'), { recursive: true })
if (!LINUX) await runtime()

async function runtime() {
  await bundle('packages/runtime/src/agentd/agentd.ts', 'packages/runtime/src/agentd/agentd.mjs')
  await bundle('packages/runtime/src/server/app.ts', 'packages/runtime/src/server/platform/app.mjs')
  writeFileSync(join(OUT, 'BUILD'), `${JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version}-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()}\n`)
  writeFileSync(join(OUT, 'packages/runtime/package.json'), JSON.stringify({ version: JSON.parse(readFileSync(join(ROOT, 'packages/runtime/package.json'), 'utf8')).version }))
  for (const path of ['install/agent-image', 'install/agent-browser', 'vendor/hermes-plugins']) cpSync(join(ROOT, path), join(OUT, path), { recursive: true })
  for (const name of NATIVE) cpSync(join(ROOT, 'node_modules', name), join(OUT, 'node_modules', name), { recursive: true, dereference: true })
  await claude()
}

async function claude() {
  const installer = readFileSync(join(ROOT, 'install/install.sh'), 'utf8')
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const version = /^CLAUDE=(\S+)$/m.exec(installer)[1]
  const sha256 = new RegExp(`${arch === 'arm64' ? 'aarch64' : 'x86_64'}\\)[\\s\\S]*?CLAUDE_SHA256=(\\w+)`).exec(installer)[1]
  const cached = join(import.meta.dirname, `../dist/claude-${version}-linux-${arch}`)
  if (!existsSync(cached)) {
    const body = Buffer.from(await (await fetch(`https://downloads.claude.ai/claude-code-releases/${version}/linux-${arch}/claude`)).arrayBuffer())
    if (createHash('sha256').update(body).digest('hex') !== sha256) throw new Error(`claude ${version} linux-${arch} doesn't match the installer's checksum`)
    writeFileSync(cached, body)
  }
  mkdirSync(join(OUT, 'bin'), { recursive: true })
  cpSync(cached, join(OUT, 'bin/claude'))
  chmodSync(join(OUT, 'bin/claude'), 0o755)
  writeFileSync(join(OUT, 'bin/claude-version'), version)
}
