import { existsSync, readFileSync } from 'node:fs'
import type { PhaseResults } from './e2e.ts'

const RESULTS = 'packages/e2e/results'
const sameTree = process.argv[2] === 'same'
const rows: string[] = []
let pass = 0
let total = 0

for (const phase of ['main', 'after-upgrade', 'after-restart']) {
  const file = `${RESULTS}/e2e-${phase}.json`
  if (!existsSync(file)) {
    rows.push(`| ${phase} | (phase did not run) | | | **FAIL** |`)
    total++
    continue
  }
  const run: PhaseResults = JSON.parse(readFileSync(file, 'utf8'))
  rows.push(`| | **${phase}** · ${run.at} | | | |`)
  for (const x of run.results) {
    total++
    if (x.pass) pass++
    rows.push(`| ${x.id} | ${cell(x.check)} | ${cell(x.expected)} | \`${cell(x.actual)}\` | ${x.pass ? 'PASS' : '**FAIL**'} |`)
  }
}
const sources = sameTree ? 'the tree matches what the run tested' : '**the tree changed during the run**'
console.log(
  `# Fast Monkey e2e report\n\n${pass}/${total} checks passed\n\nSources: ${sources}\n\n| ID | Check | Expected | Actual | Result |\n|---|---|---|---|---|\n${rows.join('\n')}`,
)
process.exit(pass === total && sameTree ? 0 : 1)

function cell(s: string) {
  return s
    .replace(/\s*\n\s*/g, ' ⏎ ')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .slice(0, 300)
}
