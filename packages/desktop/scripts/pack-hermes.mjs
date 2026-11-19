import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../..')
const PIN = JSON.parse(readFileSync(join(ROOT, 'install/native-runtime.json'), 'utf8'))
const WIN = process.platform === 'win32'
const PLATFORM = `${WIN ? 'win32' : process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const SKIP = new Set(['tests', 'tests-js', 'website', 'apps', 'evals', 'web', 'ui-tui', '.github', 'docker', 'nix', 'contributors'])
const LAUNCHER = `import os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(here, 'hermes'), os.path.join(here, 'site')]
sys.argv[0] = 'hermes'
from hermes_cli.main import main
sys.exit(main())
`

const sha256 = (body) => createHash('sha256').update(body).digest('hex')

async function fetched({ url, sha }) {
  const body = Buffer.from(await (await fetch(url)).arrayBuffer())
  if (sha256(body) !== sha) throw new Error(`${url} doesn't match its pinned sha256`)
  return body
}

export async function packHermes(out) {
  const cache = join(import.meta.dirname, '../dist/hermes-cache', `${PIN.hermes.tag}-${PLATFORM}`)
  if (!existsSync(join(cache, 'hermes.py'))) await build(cache)
  rmSync(out, { recursive: true, force: true })
  cpSync(cache, out, { recursive: true, dereference: true })
  if (!WIN) relink(join(out, 'python/bin'))
}

async function build(out) {
  const work = join(tmpdir(), `openhut-hermes-${process.pid}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  writeFileSync(join(work, 'src.tar.gz'), await fetched({ url: PIN.hermes.url, sha: PIN.hermes.sha256 }))
  execFileSync('tar', ['-xzf', 'src.tar.gz'], { cwd: work })
  const src = join(work, readdirSync(work).find((name) => name.startsWith('hermes-agent-')))
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(work, 'python'), UV_PROJECT_ENVIRONMENT: join(work, 'venv'), UV_PYTHON_PREFERENCE: 'only-managed' }
  execFileSync('uv', ['python', 'install', PIN.hermes.python], { env, stdio: 'inherit' })
  execFileSync('uv', ['sync', '--frozen', '--no-dev', '--python', PIN.hermes.python, ...PIN.hermes.extras.flatMap((extra) => ['--extra', extra])], { cwd: src, env, stdio: 'inherit' })
  const python = execFileSync('uv', ['python', 'find', PIN.hermes.python], { env }).toString().trim()
  const home = WIN ? join(python, '..') : join(python, '../..')
  rmSync(out, { recursive: true, force: true })
  cpSync(home, join(out, 'python'), { recursive: true, dereference: true })
  if (!WIN) relink(join(out, 'python/bin'))
  const site = WIN ? join(work, 'venv/Lib/site-packages') : join(work, 'venv/lib', readdirSync(join(work, 'venv/lib'))[0], 'site-packages')
  cpSync(site, join(out, 'site'), { recursive: true, dereference: true, filter: (path) => !/__editable__|_virtualenv|hermes_agent-.*\.dist-info/.test(path) })
  for (const name of readdirSync(src).filter((each) => !SKIP.has(each))) cpSync(join(src, name), join(out, 'hermes', name), { recursive: true, dereference: true })
  writeFileSync(join(out, 'hermes.py'), LAUNCHER)
  const bin = WIN ? join(out, 'python/python.exe') : join(out, 'python/bin/python3')
  execFileSync(bin, ['-s', '-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'unchecked-hash', join(out, 'hermes'), join(out, 'site')], { stdio: 'inherit' })
  execFileSync(bin, ['-s', join(out, 'hermes.py'), '--version'], { stdio: 'inherit' })
  rmSync(work, { recursive: true, force: true })
}

function relink(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (!lstatSync(path).isSymbolicLink()) continue
    const target = readlinkSync(path)
    if (!isAbsolute(target)) continue
    rmSync(path)
    symlinkSync(basename(target), path)
  }
}

export async function packClaude(out) {
  const sha = PIN.claude.sha256[PLATFORM]
  if (!sha) throw new Error(`no pinned Claude Code for ${PLATFORM}`)
  const file = join(out, WIN ? 'claude.exe' : 'claude')
  if (existsSync(file) && sha256(readFileSync(file)) === sha) return file
  mkdirSync(out, { recursive: true })
  const cached = join(import.meta.dirname, '../dist/claude-cache', `${PIN.claude.version}-${PLATFORM}`, WIN ? 'claude.exe' : 'claude')
  if (!existsSync(cached) || sha256(readFileSync(cached)) !== sha) {
    mkdirSync(join(cached, '..'), { recursive: true })
    writeFileSync(cached, await fetched({ url: `https://downloads.claude.ai/claude-code-releases/${PIN.claude.version}/${PLATFORM}/${WIN ? 'claude.exe' : 'claude'}`, sha }))
  }
  cpSync(cached, file)
  writeFileSync(`${file}.version`, PIN.claude.version)
  if (!WIN) chmodSync(file, 0o755)
  return file
}
