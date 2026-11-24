import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [command = '', ...files] = process.argv.slice(2)
if (!command || !files.length) {
  console.error('Usage: node scripts/mutate.ts "<test command>" <file.ts>...')
  process.exit(2)
}

const SWAPS: [RegExp, string][] = [
  [/===/g, '!=='], [/!==/g, '==='], [/ && /g, ' || '], [/ \|\| /g, ' && '], [/ \?\? /g, ' || '],
  [/ < /g, ' <= '], [/ <= /g, ' < '], [/ > /g, ' >= '], [/ >= /g, ' > '],
  [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'], [/ \+ 1\b/g, ' - 1'], [/ - 1\b/g, ' + 1'],
  [/\.some\(/g, '.every('], [/\.every\(/g, '.some('], [/!(?=[\w(])/g, ''],
]

function mutants(source: string): { line: number; text: string }[] {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (/^\s*(import|export (type|\{)|\/\/)/.test(line) || !line.trim()) return []
    return SWAPS.flatMap(([pattern, swap]) => [...line.matchAll(pattern)].map((match) => {
      const at = match.index ?? 0
      const changed = `${line.slice(0, at)}${swap}${line.slice(at + match[0].length)}`
      return { line: index + 1, text: [...lines.slice(0, index), changed, ...lines.slice(index + 1)].join('\n') }
    }))
  })
}

const run = () => spawnSync('sh', ['-c', command], { stdio: 'ignore', timeout: 180_000 }).status === 0
if (!run()) throw new Error('The tests fail before any mutation. Fix them first.')
let total = 0
let killed = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  try {
    for (const mutant of mutants(source)) {
      writeFileSync(file, mutant.text)
      total += 1
      if (run()) console.log(`survived ${file}:${mutant.line}`)
      else killed += 1
    }
  } finally {
    writeFileSync(file, source)
  }
}
const score = total ? (100 * killed) / total : 100
console.log(`mutation score ${killed}/${total} = ${score.toFixed(1)}%`)
if (score < Number(process.env.MUTATION_MIN ?? 0)) process.exitCode = 1
