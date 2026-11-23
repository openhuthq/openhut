import { mkdirSync, readdirSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import { browser } from './browser.ts'
import { commands, type Command } from './commands.ts'
import { firewall } from './firewall.ts'
import { box, DATA, ID } from './host.ts'
import { errorText, isRecord } from './util.ts'

const MAX_REQUEST = 1 << 20
const queues = new Map<string, Promise<unknown>>()

export async function boot(): Promise<void> {
  if (box.name === 'native') {
    const { sweep } = await import('./sandbox/native.ts')
    sweep()
    process.on('exit', sweep)
    process.on('SIGTERM', sweep)
  }
  for (const dir of [`${DATA}/agents`, `${DATA}/agent-conf`]) mkdirSync(dir, { recursive: true, mode: 0o700 })
  browser.freeAll(readdirSync(`${DATA}/agent-conf`).filter((name) => ID.test(name)))
  firewall.watch()
}

export function serve(sock: Duplex) {
  let buf = ''
  const read = (chunk: string | Buffer) => {
    buf += chunk
    const end = buf.indexOf('\n')
    if (end < 0 && buf.length <= MAX_REQUEST) return
    sock.off('data', read)
    sock.pause()
    if (end < 0 || end > MAX_REQUEST) {
      sock.end(JSON.stringify({ ok: false, error: 'request too large' }))
      return
    }
    Promise.resolve(buf.slice(0, end))
      .then((line) => dispatch({ sock, line, rest: buf.slice(end + 1) }))
      .then(
        (reply) => reply && sock.end(JSON.stringify({ ok: true, ...reply })),
        (e) => sock.end(JSON.stringify({ ok: false, error: errorText(e).slice(0, 2000) })),
      )
  }
  sock.setEncoding('utf8')
  sock.on('data', read)
  sock.on('error', () => {})
}

async function dispatch({ sock, line, rest }: { sock: Duplex; line: string; rest: string }): Promise<object | undefined> {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value) || typeof value.cmd !== 'string' || !Object.hasOwn(commands, value.cmd)) throw new Error(`unknown command ${String(isRecord(value) ? value.cmd : value)}`)
  const command: Command = commands[value.cmd as keyof typeof commands]
  const request: Record<string, unknown> = command.parse(value)
  const id = typeof request.id === 'string' ? request.id : undefined
  const queue = (work: () => Promise<unknown>) => (id ? enqueue(id, work) : work())
  const run = command.run as (request: object, stream: { sock: Duplex; rest: string; queue: typeof queue }) => Promise<object | undefined>
  if (command.stream) return run(request, { sock, rest, queue })
  const body = command.body === undefined ? undefined : await restOf({ sock, rest, limit: command.body })
  return queue(() => run(body === undefined ? request : { ...request, body }, { sock, rest, queue })) as Promise<object | undefined>
}

function enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
  queues.set(id, next)
  next
    .finally(() => {
      if (queues.get(id) === next) queues.delete(id)
    })
    .catch(() => {})
  return next
}

function restOf({ sock, rest, limit }: { sock: Duplex; rest: string; limit: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = rest
    const done = () => resolve(body.split('\n')[0])
    if (rest.includes('\n')) return done()
    sock.on('data', (chunk: string) => {
      body += chunk
      if (body.includes('\n')) {
        sock.off('end', done)
        return done()
      }
      if (body.length > limit) {
        sock.off('end', done)
        sock.pause()
        reject(new Error('the request is too large'))
      }
    })
    sock.on('end', done)
    sock.resume()
  })
}

