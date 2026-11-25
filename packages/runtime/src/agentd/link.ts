import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import type { Duplex } from 'node:stream'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { mux, type Mux } from '@openhut/common/tunnel/mux.ts'
import { config } from './config.ts'

const LINK = `${config.data}/link`
const FAILED = `${config.data}/failed-images`
const UPDATE_LOG = `${config.data}/update.log`
const LINKED = '/run/openhut-linked'
const ID = /^ag_[a-z0-9]{8}$/
const HELLO_MS = 60_000
const run = promisify(execFile)

let current: Mux | undefined
let wait = 1_000

function accept(open: Record<string, unknown>, stream: Duplex): void {
  const id = typeof open.id === 'string' && ID.test(open.id) ? open.id : undefined
  if (open.to === 'agentd') return join(stream, connect(config.socket))
  if (open.to === 'agent' && Number.isInteger(open.net) && Number(open.net) >= 1 && Number(open.net) <= 250) return join(stream, connect(8642, `10.200.${Number(open.net)}.2`))
  if (open.to === 'pack' && id) return pack(id, stream)
  if (open.to === 'unpack' && id) return unpack(id, stream)
  stream.destroy()
}

function join(stream: Duplex, socket: Duplex): void {
  stream.pipe(socket).pipe(stream)
  socket.on('error', () => stream.destroy())
  stream.on('error', () => socket.destroy())
  stream.on('close', () => socket.destroy())
  socket.on('close', () => stream.destroy())
}

function pack(id: string, stream: Duplex): void {
  if (!existsSync(`${config.data}/agents/${id}`)) return void stream.destroy()
  const tar = spawn('tar', ['-C', `${config.data}/agents`, '-cf', '-', id], { stdio: ['ignore', 'pipe', 'ignore'] })
  tar.stdout.pipe(stream, { end: false })
  tar.on('close', (code) => code === 0 ? stream.end() : stream.destroy())
  stream.on('close', () => tar.kill())
}

function unpack(id: string, stream: Duplex): void {
  rmSync(`${config.data}/agents/${id}`, { recursive: true, force: true })
  const tar = spawn('tar', ['-C', `${config.data}/agents`, '-xpf', '-', id], { stdio: ['pipe', 'ignore', 'pipe'] })
  let said = ''
  tar.stderr.on('data', (chunk: Buffer) => { said += chunk })
  stream.pipe(tar.stdin)
  tar.stdin.on('error', () => undefined)
  tar.on('close', (code) => stream.end(code === 0 ? 'ok' : said.trim() || `tar exited with ${code}`))
}

function updateError(image: string): string | null {
  if (!image || !failed().includes(image)) return null
  const said = existsSync(UPDATE_LOG) ? readFileSync(UPDATE_LOG, 'utf8').split('\n').findLast((line) => line.startsWith('openhut: ')) : undefined
  return said?.slice('openhut: '.length) ?? 'The new version didn’t start, so this computer went back to the previous one.'
}

function failed(): string[] {
  return existsSync(FAILED) ? readFileSync(FAILED, 'utf8').split('\n').filter(Boolean) : []
}

async function follow(image: string): Promise<void> {
  if (!image || !config.runtimeImage || image === config.runtimeImage || failed().includes(image)) return
  const docker = (...args: string[]) => run('docker', ['-H', config.hostDocker, ...args])
  if (await docker('container', 'inspect', 'openhut-runtime-update').then(() => true, () => false)) return
  console.log(`link: following the main install to ${image}`)
  await docker('run', '-d', '--rm', '--name', 'openhut-runtime-update', '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', 'openhut-runtime-data:/data',
    '-e', `RUNTIME_IMAGE=${image}`, '--entrypoint', 'sh', config.runtimeImage, '-c',
    'sh /opt/openhut/install/install.sh join > /data/update.log 2>&1 || echo "$RUNTIME_IMAGE" >> /data/failed-images')
}

async function hello(image: string): Promise<Record<string, unknown>> {
  const health = await ask({ cmd: 'health' }).catch(() => undefined)
  const features = health?.features as { whatsapp: boolean; browser: boolean } | undefined
  return { type: 'hello', name: config.name, version: config.build, gvisor: typeof health?.gvisor === 'boolean' ? health.gvisor : null, features: features ?? { whatsapp: false, browser: false }, updateError: updateError(image) }
}

function ask(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.socket)
    let reply = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { reply += chunk })
    socket.on('end', () => { try { resolve(JSON.parse(reply) as Record<string, unknown>) } catch (err) { reject(err) } })
    socket.on('error', reject)
    socket.write(`${JSON.stringify(request)}\n`)
  })
}

function dial(): void {
  const [address, token] = readFileSync(LINK, 'utf8').trim().split(/\s+/)
  const url = `${address.replace(/^http/, 'ws')}/api/computers/link`
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, maxPayload: 1 << 20 })
  const link = mux({
    odd: true,
    send: (bytes, done) => socket.send(bytes, (err) => done(err ?? undefined)),
    accept,
    heard: (message) => {
      if (message.type !== 'welcome') return
      if (typeof message.token === 'string' && /^ohj_[\w-]{20,100}$/.test(message.token)) writeFileSync(LINK, `${address} ${message.token}\n`, { mode: 0o600 })
      const image = typeof message.runtimeImage === 'string' ? message.runtimeImage : ''
      try { writeFileSync(LINKED, `${new Date().toISOString()}\n`) } catch { console.log('link: no /run to mark the link in') }
      wait = 1_000
      void follow(image).catch((err: unknown) => console.error(`link: couldn't start the update: ${String(err)}`))
      const tell = () => void hello(image).then((said) => link.say(said))
      tell()
      const again = setInterval(tell, HELLO_MS)
      socket.once('close', () => clearInterval(again))
    },
  })
  socket.on('open', () => {
    current = link
    console.log(`link: connected to ${address}`)
  })
  socket.on('message', (data, binary) => {
    try {
      if (!binary) throw new Error('text on the link')
      link.receive(new Uint8Array(data as Buffer))
    } catch (err) {
      console.error(`link: ${String(err)}`)
      socket.terminate()
    }
  })
  socket.on('error', (err) => console.error(`link: ${err.message}`))
  socket.on('close', (code, reason) => {
    link.close()
    if (current === link) current = undefined
    const next = code === 4000 ? 600_000 : code === 4401 ? 60_000 : wait
    wait = Math.min(wait * 2, 30_000)
    console.log(`link: closed (${code} ${reason.toString()}), again in ${next / 1000}s`)
    setTimeout(dial, next)
  })
}

function serveGateway(): void {
  createServer((socket) => {
    if (!current) return socket.destroy()
    join(current.open({ to: 'gateway' }), socket)
  }).listen(config.gatewayPort, '0.0.0.0', () => console.log(`link: the agents' gateway on :${config.gatewayPort}`))
}

serveGateway()
dial()
