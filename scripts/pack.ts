// Builds the three packs from packages/desktop/dist (run `npm -w @openhut/desktop run build && npm -w @openhut/desktop run pack-backend` first):
// openhut-app.tgz (renderer, server and agentd JS, hermes-plugins: the same on every OS), openhut-runtime-<platform>.tgz (Hermes,
// Python, Node) and openhut-native-<platform>.tgz (agent-browser). Each has a manifest .json with every file's sha512. Paths are
// relative to the backend folder, so the three packs extract into one tree laid out like dist/backend.
// Deterministic: sorted entries, fixed mtime, uid/gid 0, modes 0644/0755, gzip header without a time and with OS byte 3.
import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, writeFileSync, writeSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

const DIST = process.env.OPENHUT_PACK_DIST ?? join(import.meta.dirname, '../packages/desktop/dist')
const BACKEND = join(DIST, 'backend')
const MTIME = 946684800 // 2000-01-01, any fixed time works
const PLATFORM = `${process.platform}-${process.arch}`
const version: string = JSON.parse(readFileSync(join(import.meta.dirname, '../packages/desktop/package.json'), 'utf8')).version

type Entry = { path: string; abs: string; kind: 'file' | 'dir' | 'link'; mode: number }

function walk(abs: string, path: string, skip: Set<string> = new Set()): Entry[] {
  const stat = lstatSync(abs)
  if (stat.isSymbolicLink()) return [{ path, abs, kind: 'link', mode: 0o777 }]
  if (stat.isFile()) return [{ path, abs, kind: 'file', mode: stat.mode & 0o111 ? 0o755 : 0o644 }]
  const names = readdirSync(abs).filter((name) => !skip.has(name) && name !== '.DS_Store').sort()
  return [{ path: `${path}/`, abs, kind: 'dir', mode: 0o755 }, ...names.flatMap((name) => walk(join(abs, name), `${path}/${name}`))]
}

function header(name: string, size: number, type: string, mode = 0o644, link = '') {
  const block = Buffer.alloc(512)
  const put = (value: string, at: number, length: number) => block.write(value, at, length, 'utf8')
  const octal = (value: number, at: number, length: number) => put(value.toString(8).padStart(length - 1, '0'), at, length - 1)
  put(name, 0, 100)
  octal(mode, 100, 8)
  octal(0, 108, 8)
  octal(0, 116, 8)
  octal(size, 124, 12)
  octal(MTIME, 136, 12)
  put('        ', 148, 8)
  put(type, 156, 1)
  put(link, 157, 100)
  put('ustar\u000000', 257, 8)
  put('root', 265, 32)
  put('root', 297, 32)
  octal(block.reduce((sum, byte) => sum + byte, 0), 148, 7)
  return block
}

const pad = (size: number) => Buffer.alloc((512 - (size % 512)) % 512)

// A PAX record for names or link targets longer than ustar's 100 bytes.
function pax(entry: Entry, link: string) {
  const records = [['path', entry.path], ...(Buffer.byteLength(link) > 100 ? [['linkpath', link]] : [])].map(([key, value]) => {
    const body = ` ${key}=${value}\n`
    let length = Buffer.byteLength(body)
    while (Buffer.byteLength(`${length}${body}`) !== length) length = Buffer.byteLength(`${length}${body}`)
    return `${length}${body}`
  }).join('')
  const data = Buffer.from(records)
  return [header('PaxHeader', data.length, 'x'), data, pad(data.length)]
}

const sha512 = (body: Buffer) => createHash('sha512').update(body).digest('base64')

function* tar(entries: Entry[], files: Record<string, string>) {
  for (const entry of entries) {
    const link = entry.kind === 'link' ? readlinkSync(entry.abs) : ''
    const body = entry.kind === 'file' ? readFileSync(entry.abs) : Buffer.alloc(0)
    if (entry.kind !== 'dir') files[entry.path] = link ? `link:${link}` : sha512(body)
    if (Buffer.byteLength(entry.path) > 100 || Buffer.byteLength(link) > 100) yield* pax(entry, link)
    yield header(entry.path.slice(0, 100), body.length, { file: '0', dir: '5', link: '2' }[entry.kind], entry.mode, link.slice(0, 100))
    yield body
    yield pad(body.length)
  }
  yield Buffer.alloc(1024)
}

async function pack(name: string, out: string, entries: Entry[], extra: Record<string, string> = {}) {
  const tgz = join(out, `openhut-${name}.tgz`)
  const files: Record<string, string> = {}
  await pipeline(Readable.from(tar(entries, files)), createGzip(), createWriteStream(tgz))
  const fd = openSync(tgz, 'r+')
  writeSync(fd, Buffer.from([3]), 0, 1, 9) // zlib writes its build's OS code here (19 on macOS); 3 (Unix) everywhere
  closeSync(fd)
  writeFileSync(join(out, `openhut-${name}.json`), `${JSON.stringify({ pack: name, version, ...extra, files }, null, 2)}\n`)
  console.log(`${relative(process.cwd(), tgz)}: ${Object.keys(files).length} files, sha512 ${sha512(readFileSync(tgz))}`)
}

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/pack.ts <out folder>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const app = [...walk(BACKEND, '', new Set(['runtime', 'bin', 'node_modules'])), ...walk(join(DIST, 'renderer'), 'renderer')]
  .map((entry) => ({ ...entry, path: entry.path.replace(/^\//, '') })).filter((entry) => entry.path)
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
await pack('app', out, app)
await pack(`runtime-${PLATFORM}`, out, walk(join(BACKEND, 'runtime'), 'runtime'), { platform: PLATFORM })
await pack(`native-${PLATFORM}`, out, walk(join(BACKEND, 'bin'), 'bin'), { platform: PLATFORM })
