// The sha256 of every file a run ships or tests, one "<sha>  <path>" line each. e2e.sh records it before the run;
// report.ts compares it with the tree, so results never pass for code that changed after them.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['package.json', 'package-lock.json', 'install', 'scripts', 'vendor', 'packages/app/src', 'packages/app/package.json', 'packages/common/src',
  'packages/agentd/src', 'packages/web/src', 'packages/web/index.html', 'packages/e2e/src', 'packages/e2e/e2e.sh']
const walk = (p: string): string[] => statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((f) => f === 'node_modules' ? [] : walk(join(p, f))) : [p]
export const fingerprint = () => ROOTS.flatMap(walk).map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${f}`).join('\n') + '\n'

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(fingerprint())
