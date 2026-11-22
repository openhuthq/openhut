import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PhaseResults } from './e2e.ts'

const RESULTS = process.env.RESULTS ?? 'packages/e2e/results'
const CLOUD_STATE = process.env.CLOUD_STATE ?? `${RESULTS}/cloud-state`
const CONTROL = 'mo@example.com'
const canaries = JSON.parse(readFileSync(`${RESULTS}/cloud-canaries.json`, 'utf8')) as Record<string, string | string[]>
const words = Object.entries(canaries).flatMap(([kind, value]) => [value].flat().map((text) => ({ kind, text })))

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)])
const all = files(CLOUD_STATE)
const rooms = all.filter((file) => file.endsWith('.sqlite'))
const blobs = all.filter((file) => /\/r2\/openhut-files\/blobs\//.test(file))
const dump = rooms.map((file) => `-- ${file}\n${execFileSync('sqlite3', ['-readonly', file, '.dump'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })}`).join('\n')
writeFileSync(`${RESULTS}/cloud-room-dump.sql`, dump)
const bytes = [...all.map((file) => ({ file, body: readFileSync(file) })), { file: 'cloud-room-dump.sql', body: Buffer.from(dump) }]

let runs = 0
const decoded = (body: Buffer, depth = 0): Buffer[] => {
  const text = body.toString('latin1')
  const found = [
    ...[...text.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)].map(([run]) => Buffer.from(run, 'base64')),
    ...[...text.matchAll(/X'((?:[0-9A-Fa-f]{2}){8,})'/g)].map(([, hex]) => Buffer.from(hex ?? '', 'hex')),
  ]
  runs += found.length
  return depth < 1 ? [...found, ...found.flatMap((each) => decoded(each, depth + 1))] : found
}
const inside = bytes.map(({ file, body }) => ({ file, body, decoded: decoded(body) }))
const seen = (text: string) => ({
  raw: inside.filter(({ body }) => body.includes(text)).map(({ file }) => file),
  decoded: inside.filter(({ decoded }) => decoded.some((each) => each.includes(text))).map(({ file }) => file),
})

const lines = words.map(({ kind, text }) => {
  const { raw, decoded } = seen(text)
  return { kind, text, hits: [...new Set([...raw, ...decoded.map((file) => `${file} (decoded)`)])] }
})
const control = seen(CONTROL)
const report = [
  `control: the member list email ${CONTROL} is found in ${control.raw.length} files as plain text and in ${control.decoded.length} after decoding the base64 runs that hold it (the member list bytes), so the grep reads the room and the decoder works`,
  `dumped ${rooms.length} Durable Object databases (${dump.length} bytes), grepped ${all.length} files under ${CLOUD_STATE} (${blobs.length} R2 file blobs) raw and after decoding ${runs} base64, base64url and hex runs`,
  ...lines.map(({ kind, text, hits }) => `${kind} "${text}": ${hits.length} hits${hits.length ? ` (${hits.join(', ')})` : ''}`),
].join('\n')
writeFileSync(`${RESULTS}/security-grep.txt`, `${report}\n`)
console.log(report)
const leaked = lines.filter((line) => line.hits.length > 0)
const pass = leaked.length === 0 && rooms.length > 0 && blobs.length > 0 && control.raw.length > 0 && control.decoded.length > 0
const result: PhaseResults = {
  phase: 'security',
  at: new Date().toISOString(),
  passed: pass ? 1 : 0,
  failed: pass ? 0 : 1,
  results: [{
    id: 'S1',
    check: 'The workspace room and its R2 files, dumped after the run, hold no agent name, instructions, message, reply, attached file, connection name or connection key in plain text, base64, base64url or hex',
    expected: `0 hits for each of ${words.length} canaries in the SQL dump and every raw file, raw and decoded; at least one R2 file blob; the member email found plain and only-decoded (controls)`,
    actual: `${rooms.length} databases, ${all.length} files, ${blobs.length} R2 blobs, ${runs} decoded runs; ${lines.map(({ kind, hits }) => `${kind} ${hits.length}`).join(', ')}; control ${control.raw.length} plain, ${control.decoded.length} decoded`,
    pass,
  }],
}
writeFileSync(`${RESULTS}/e2e-security.json`, JSON.stringify(result, null, 2))
process.exit(result.failed)
