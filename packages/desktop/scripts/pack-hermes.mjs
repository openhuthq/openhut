import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../..')
const PIN = JSON.parse(readFileSync(join(ROOT, 'install/native-runtime.json'), 'utf8'))
const WIN = process.platform === 'win32'
const LINUX = process.platform === 'linux'
const PLATFORM = `${WIN ? 'win32' : process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const CACHE = join(import.meta.dirname, '../dist/native-cache')
const SKIP = new Set(['tests', 'tests-js', 'website', 'apps', 'evals', 'web', 'ui-tui', '.github', 'docker', 'nix', 'contributors'])
const LAUNCHER = `import os, site, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, 'hermes'))
site.addsitedir(os.path.join(here, 'site'))
sys.argv[0] = 'hermes'
from hermes_cli.main import main
sys.exit(main())
`

const sha256 = (body) => createHash('sha256').update(body).digest('hex')

export async function packHermes(out) {
  const cache = join(CACHE, 'hermes', `${PIN.hermes.tag}-${PLATFORM}`)
  if (!existsSync(join(cache, 'hermes.py'))) await build(cache)
  rmSync(out, { recursive: true, force: true })
  cpSync(cache, out, { recursive: true, dereference: true })
  writeFileSync(join(out, 'hermes.py'), LAUNCHER)
  if (!WIN) relink(out)
  slim(out)
  if (!existsSync(join(out, 'hermes/scripts/whatsapp-bridge/node_modules'))) throw new Error(`the WhatsApp bridge is missing from ${out}; delete ${cache} and pack again`)
  if (!LINUX) await packNode(join(out, 'node'))
  if (!WIN) execFileSync(join(out, 'python/bin/python3'), ['-s', '-B', join(out, 'hermes.py'), '--version'], { stdio: 'inherit' })
}

function slim(out) {
  const lib = join(out, 'python', WIN ? 'Lib' : 'lib')
  const unused = readdirSync(lib).filter((name) => /^(tcl|tk|itcl|thread)\d|^lib(tcl|tk)/.test(name) || (!WIN && /^libpython3/.test(name)))
  for (const name of unused) rmSync(join(lib, name), { recursive: true, force: true })
  const packages = WIN ? join(lib, 'site-packages') : join(lib, readdirSync(lib).find((name) => /^python3\.\d+$/.test(name)) ?? '', 'site-packages')
  for (const name of existsSync(packages) ? readdirSync(packages).filter((each) => /^pip[-.]|^pip$/.test(each)) : []) rmSync(join(packages, name), { recursive: true, force: true })
  for (const dir of caches(out)) rmSync(dir, { recursive: true, force: true })
}

function caches(dir) {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => entry.name === '__pycache__' ? [join(dir, entry.name)] : caches(join(dir, entry.name)))
}

async function build(out) {
  const work = join(tmpdir(), `openhut-hermes-${process.pid}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const src = join(work, 'hermes-agent')
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', PIN.hermes.tag, PIN.hermes.repo, src])
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: src }).toString().trim()
  if (commit !== PIN.hermes.commit) throw new Error(`Hermes ${PIN.hermes.tag} is ${commit}, not the pinned ${PIN.hermes.commit}`)
  rmSync(join(src, '.git'), { recursive: true, force: true })
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(work, 'python'), UV_PROJECT_ENVIRONMENT: join(work, 'venv'), UV_PYTHON_PREFERENCE: 'only-managed' }
  execFileSync('uv', ['python', 'install', PIN.hermes.python], { env, stdio: 'inherit' })
  execFileSync('uv', ['sync', '--frozen', '--no-dev', '--python', PIN.hermes.python, ...PIN.hermes.extras.flatMap((extra) => ['--extra', extra])], { cwd: src, env, stdio: 'inherit' })
  const python = execFileSync('uv', ['python', 'find', PIN.hermes.python], { env }).toString().trim()
  const home = WIN ? join(python, '..') : join(python, '../..')
  rmSync(out, { recursive: true, force: true })
  cpSync(home, join(out, 'python'), { recursive: true, dereference: true })
  if (!WIN) {
    relink(join(out, 'python'))
    trim(join(out, 'python'))
  }
  const site = WIN ? join(work, 'venv/Lib/site-packages') : join(work, 'venv/lib', readdirSync(join(work, 'venv/lib'))[0], 'site-packages')
  cpSync(site, join(out, 'site'), { recursive: true, dereference: true, filter: (path) => !/__editable__|_virtualenv|hermes_agent-.*\.dist-info/.test(path) })
  for (const name of readdirSync(src).filter((each) => !SKIP.has(each))) cpSync(join(src, name), join(out, 'hermes', name), { recursive: true, dereference: true })
  const bridge = join(out, 'hermes/scripts/whatsapp-bridge')
  execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: bridge, stdio: 'inherit', shell: WIN })
  rmSync(join(bridge, 'node_modules/.bin'), { recursive: true, force: true })
  writeFileSync(join(bridge, 'node_modules/.hermes-pkg-hash'), sha256(readFileSync(join(bridge, 'package.json'))).slice(0, 16))
  writeFileSync(join(out, 'hermes.py'), LAUNCHER)
  const bin = WIN ? join(out, 'python/python.exe') : join(out, 'python/bin/python3')
  execFileSync(bin, ['-s', '-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'unchecked-hash', join(out, 'hermes'), join(out, 'site')], { stdio: 'inherit' })
  execFileSync(bin, ['-s', join(out, 'hermes.py'), '--version'], { stdio: 'inherit' })
  rmSync(work, { recursive: true, force: true })
}

function relink(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isDirectory()) relink(path)
    if (!stat.isSymbolicLink()) continue
    const target = readlinkSync(path)
    if (!isAbsolute(target)) continue
    rmSync(path)
    if (existsSync(join(dir, basename(target)))) symlinkSync(basename(target), path)
  }
}

function trim(python) {
  const lib = join(python, 'lib', readdirSync(join(python, 'lib')).find((name) => /^python3\.\d+$/.test(name)) ?? '')
  for (const path of [join(python, 'include'), join(python, 'share'), join(python, 'lib/pkgconfig'), ...['test', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip'].map((name) => join(lib, name))]) rmSync(path, { recursive: true, force: true })
}

async function cachedFile({ dir, name, url, check }) {
  const file = join(CACHE, dir, name)
  if (existsSync(file) && check(readFileSync(file))) return file
  mkdirSync(join(CACHE, dir), { recursive: true })
  const body = Buffer.from(await (await fetch(url)).arrayBuffer())
  if (!check(body)) throw new Error(`${url} doesn't match its pinned checksum`)
  writeFileSync(file, body)
  return file
}

function unpacked({ file, path }) {
  const work = join(tmpdir(), `openhut-unpack-${process.pid}-${basename(file)}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  execFileSync('tar', ['-xf', file, '-C', work])
  return join(work, path)
}

async function packNode(out) {
  const name = `node-v${PIN.node.version}-${WIN ? 'win-x64' : PLATFORM}`
  const file = await cachedFile({ dir: 'node', name: `${name}.${WIN ? 'zip' : 'tar.gz'}`, url: `https://nodejs.org/dist/v${PIN.node.version}/${name}.${WIN ? 'zip' : 'tar.gz'}`, check: (body) => sha256(body) === PIN.node.sha256[PLATFORM] })
  mkdirSync(out, { recursive: true })
  cpSync(unpacked({ file, path: join(name, WIN ? 'node.exe' : 'bin/node') }), join(out, WIN ? 'node.exe' : 'node'))
}

export async function packAgentBrowser(out) {
  const { version, package: pkg, sha512 } = PIN.agentBrowser
  const file = await cachedFile({ dir: 'agent-browser', name: `${pkg[PLATFORM]}-${version}.tgz`, url: `https://registry.npmjs.org/@agent-browser/${pkg[PLATFORM]}/-/${pkg[PLATFORM]}-${version}.tgz`, check: (body) => createHash('sha512').update(body).digest('hex') === sha512[PLATFORM] })
  const name = WIN ? 'agent-browser.exe' : 'agent-browser'
  mkdirSync(out, { recursive: true })
  cpSync(unpacked({ file, path: `package/bin/${name}` }), join(out, name))
  if (!WIN) chmodSync(join(out, name), 0o755)
}
