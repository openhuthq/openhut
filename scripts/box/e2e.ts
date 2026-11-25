import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ENV = process.env.BOX_ENV ?? 'box'
const PREVIEW_PORT = 8788
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { runtimes: { type: 'string', default: '1' }, script: { type: 'string', default: 'https://openhut.dev' }, code: { type: 'string' }, cmd: { type: 'string' } },
})
const [command, run, ...rest] = positionals
if (!command || !run || !/^[a-z0-9-]{1,20}$/.test(run)) usage()
const OUT = resolve(process.env.BOX_E2E_OUT ?? 'plan/deploy-evidence', run)
mkdirSync(OUT, { recursive: true })

const main = `oh-${run}-main`
const host = (agent: string) => `box-${agent}.box`

switch (command) {
  case 'up': await up(Number(values.runtimes)); break
  case 'install': await install(); break
  case 'join': await join(); break
  case 'exec': process.exitCode = ssh(name(rest[0]), rest.slice(1).join(' ')).status ?? 1; break
  case 'logs': logs(); break
  case 'down': down(); break
  default: usage()
}

function usage(): never {
  console.error('usage: node scripts/box/e2e.ts <up|install|join|exec|logs|down> <run-id> [...]\n  up <run> [--runtimes N]\n  install <run> [--script <url|file>]\n  join <run> (--code <code> | --cmd \'<command from main>\')\n  exec <run> <main|rtN> <cmd...>\n  logs <run>\n  down <run>')
  process.exit(2)
}

function name(machine = 'main'): string {
  return machine === 'main' ? main : `oh-${run}-${machine}`
}

function machines(): string[] {
  const listed = spawnSync('box', ['ls'], { encoding: 'utf8' }).stdout
  return [...listed.matchAll(new RegExp(`^box-(oh-${run}-\\S+)`, 'gm'))].map((m) => m[1])
}

function log(line: string) {
  console.log(line)
  appendFileSync(`${OUT}/harness.log`, `${new Date().toISOString()} ${line}\n`)
}

function ssh(agent: string, cmd: string, input?: string) {
  return spawnSync('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', host(agent), cmd], { encoding: 'utf8', input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] })
}

function capture(agent: string, cmd: string): string {
  const r = spawnSync('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', host(agent), cmd], { encoding: 'utf8' })
  return r.stdout + r.stderr
}

function create(agent: string, size: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('box', ['new', '-e', ENV, '-n', agent, '--size', size, '--awake', '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('exit', () => (out.includes(`box-${agent} is ready`) ? done() : fail(new Error(`box new ${agent} failed:\n${out}`))))
  })
}

async function up(runtimes: number) {
  const t0 = Date.now()
  const want: [string, string][] = [[main, 'medium'], ...Array.from({ length: runtimes }, (_, i): [string, string] => [name(`rt${i + 1}`), 'small'])]
  const have = new Set(machines())
  await Promise.all(want.filter(([agent]) => !have.has(agent)).map(([agent, size]) => create(agent, size)))
  for (const [agent] of want) {
    for (let i = 0; capture(agent, 'echo ok').trim() !== 'ok'; i++) {
      if (i > 30) throw new Error(`no ssh to ${agent}`)
      await new Promise((r) => setTimeout(r, 3000))
    }
    spawnSync('box', ['awake', `box-${agent}`, '1'], { stdio: 'ignore' })
  }
  log(`up: ${want.map(([a]) => `box-${a}`).join(' ')} ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}

async function install() {
  capture(main, `command -v socat >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq socat >/dev/null; sudo systemctl stop oh-preview 2>/dev/null; sudo systemd-run --unit oh-preview socat TCP-LISTEN:${PREVIEW_PORT},fork,reuseaddr TCP:127.0.0.1:8787`)
  const url = capture(main, `preview ${PREVIEW_PORT}`).match(/https:\/\/\S+/)?.[0]
  if (!url) throw new Error('preview gave no URL')
  writeFileSync(`${OUT}/preview-url.txt`, `${url}\n`)
  const envs = `OPENHUT_ADDRESS=${url}${process.env.RUNTIME_IMAGE ? ` RUNTIME_IMAGE=${process.env.RUNTIME_IMAGE}` : ''}`
  const script = values.script!
  const local = existsSync(script)
  const cmd = local ? `sudo env ${envs} sh -s` : `curl -fsSL ${script} | sudo env ${envs} sh`
  const t0 = Date.now()
  const r = spawnSync('ssh', ['-o', 'StrictHostKeyChecking=accept-new', host(main), `${cmd} 2>&1`], { encoding: 'utf8', input: local ? readFileSync(script) : '', maxBuffer: 1 << 26 })
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  writeFileSync(`${OUT}/install.log`, r.stdout + r.stderr)
  log(`install: ${script} exit ${r.status} in ${secs}s (output in install.log)`)
  if (r.status !== 0) process.exit(1)
  const image = capture(main, `docker image inspect -f '{{.Size}}' $(docker inspect -f '{{.Image}}' openhut)`).trim()
  log(`install: image ${(Number(image) / 1e9).toFixed(2)} GB unpacked; local health ${capture(main, 'curl -fsS http://127.0.0.1:8787/health').trim()}`)
  const setup = (r.stdout + r.stderr).match(/https:\/\/\S+\/setup\?code=\S+/)?.[0]
  if (setup) log(`install: setup link ${setup} (in install.log)`)
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${url}/health`).catch((e: Error) => e)
    if (!(res instanceof Error) && res.ok) return log(`install: ${url}/health -> ${res.status} ${await res.text()}`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`${url}/health not reachable`)
}

async function join() {
  const cmd = values.cmd ?? (values.code ? `curl -fsSL ${values.script} | sudo sh -s -- join ${values.code}` : undefined)
  if (!cmd) {
    console.error('join needs --code <code> or --cmd \'<command>\' from main (Settings > Computers > Add a computer); main cannot produce one headlessly yet (M2).')
    process.exit(2)
  }
  const rts = machines().filter((m) => m !== main)
  const results = await Promise.all(rts.map((agent) => new Promise<string>((done) => {
    const child = spawn('ssh', [host(agent), `${cmd} 2>&1`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('exit', (code) => { writeFileSync(`${OUT}/join-${agent}.log`, out); done(`${agent} exit ${code}`) })
  })))
  log(`join: ${results.join(', ')}`)
}

function logs() {
  for (const agent of machines()) {
    const dir = `${OUT}/${agent}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/docker-ps.txt`, capture(agent, 'docker ps -a; echo; docker images; echo; docker system df'))
    for (const c of capture(agent, "docker ps -a --format '{{.Names}}'").split('\n').filter(Boolean)) {
      writeFileSync(`${dir}/docker-logs-${c}.txt`, capture(agent, `docker logs --timestamps ${c}`))
    }
    writeFileSync(`${dir}/host.txt`, capture(agent, 'uname -a; uptime; df -h /; free -m; docker exec openhut sed "s/=.*/=…/" /etc/openhut/env 2>/dev/null'))
  }
  log(`logs: saved to ${OUT}`)
}

function down() {
  for (const agent of machines()) spawnSync('box', ['rm', '-f', `box-${agent}`], { stdio: 'inherit' })
  log('down: done')
}
