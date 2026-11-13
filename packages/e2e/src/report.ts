// Turns results/e2e-*.json into one Markdown table, and fails when the tree no longer matches the sources the run tested.
// node packages/e2e/src/report.ts > packages/e2e/results/e2e-report.md
import { readFileSync, existsSync } from 'node:fs'
import { fingerprint } from './sources.ts'

const R = 'packages/e2e/results'
const cell = (s: string) => String(s).replace(/\s*\n\s*/g, ' ⏎ ').replace(/\|/g, '\\|').replace(/`/g, '\'').slice(0, 300)
const rows: string[] = []
let pass = 0, total = 0
for (const phase of ['main', 'after-upgrade', 'after-restart']) {
  const f = `${R}/e2e-${phase}.json`
  if (!existsSync(f)) { rows.push(`| ${phase} | (phase did not run) | | | **FAIL** |`); total++; continue }
  const r = JSON.parse(readFileSync(f, 'utf8'))
  rows.push(`| | **${phase}** · ${r.at} | | | |`)
  for (const x of r.results) { total++; if (x.pass) pass++; rows.push(`| ${x.id} | ${cell(x.check)} | ${cell(x.expected)} | \`${cell(x.actual)}\` | ${x.pass ? 'PASS' : '**FAIL**'} |`) }
}
const tested = existsSync(`${R}/sources.sha256`) ? readFileSync(`${R}/sources.sha256`, 'utf8') : ''
const now = fingerprint()
const changed = tested ? [...new Set([...now.split('\n'), ...tested.split('\n')].filter((l) => l && !(tested.includes(l) && now.includes(l))).map((l) => l.split('  ')[1]))] : ['(no sources.sha256)']
console.log(`# JakeBox e2e report\n\n${pass}/${total} checks passed\n\nSources: ${changed.length ? `**changed since the run**: ${changed.join(', ')}` : 'the tree matches what the run tested'}\n\n| ID | Check | Expected | Actual | Result |\n|---|---|---|---|---|\n${rows.join('\n')}`)
process.exit(pass === total && !changed.length ? 0 : 1)
