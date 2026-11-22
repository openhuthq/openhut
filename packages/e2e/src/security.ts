import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PhaseResults } from './e2e.ts'

const RESULTS = process.env.RESULTS ?? 'packages/e2e/results'
const CLOUD_STATE = process.env.CLOUD_STATE ?? `${RESULTS}/cloud-state`
const canaries = JSON.parse(readFileSync(`${RESULTS}/cloud-canaries.json`, 'utf8')) as Record<string, string | string[]>
const words = Object.entries(canaries).flatMap(([kind, value]) => [value].flat().map((text) => ({ kind, text })))

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)])
const all = files(CLOUD_STATE)
const rooms = all.filter((file) => file.endsWith('.sqlite'))
const dump = rooms.map((file) => `-- ${file}\n${execFileSync('sqlite3', ['-readonly', file, '.dump'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })}`).join('\n')
writeFileSync(`${RESULTS}/cloud-room-dump.sql`, dump)
const bytes = [...all.map((file) => ({ file, body: readFileSync(file) })), { file: 'cloud-room-dump.sql', body: Buffer.from(dump) }]

const lines = words.map(({ kind, text }) => {
  const hits = bytes.filter(({ body }) => body.includes(text)).map(({ file }) => file)
  return { kind, text, hits }
})
const control = bytes.filter(({ body }) => body.includes('mo@example.com')).length
const report = [
  `control: the plain member list email mo@example.com is found in ${control} files, so the grep reads the room`,
  `dumped ${rooms.length} Durable Object databases (${dump.length} bytes) and grepped ${all.length} files under ${CLOUD_STATE}`,
  ...lines.map(({ kind, text, hits }) => `${kind} "${text}": ${hits.length} hits${hits.length ? ` (${hits.join(', ')})` : ''}`),
].join('\n')
writeFileSync(`${RESULTS}/security-grep.txt`, `${report}\n`)
console.log(report)
const leaked = lines.filter((line) => line.hits.length > 0)
const pass = leaked.length === 0 && rooms.length > 0 && control > 0
const result: PhaseResults = {
  phase: 'security',
  at: new Date().toISOString(),
  passed: pass ? 1 : 0,
  failed: pass ? 0 : 1,
  results: [{
    id: 'S1',
    check: 'The workspace room, dumped after the run, holds no agent name, instructions, message, reply, connection name or connection key in plain text',
    expected: `0 hits for each of ${words.length} canaries in the SQL dump and every raw file; the plain member email found (control)`,
    actual: `${rooms.length} databases, ${all.length} files; ${lines.map(({ kind, hits }) => `${kind} ${hits.length}`).join(', ')}; control ${control}`,
    pass,
  }],
}
writeFileSync(`${RESULTS}/e2e-security.json`, JSON.stringify(result, null, 2))
process.exit(result.failed)
