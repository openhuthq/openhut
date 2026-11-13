import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = [
  'package.json',
  'package-lock.json',
  'install',
  'scripts/release.sh',
  'vendor',
  'packages/app/src',
  'packages/app/package.json',
  'packages/common/src',
  'packages/agentd/src',
  'packages/web/src',
  'packages/web/index.html',
  'packages/e2e/src',
  'packages/e2e/e2e.sh',
]

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(fingerprint())

export function fingerprint() {
  return (
    ROOTS.flatMap(walk)
      .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${f}`)
      .join('\n') + '\n'
  )
}

function walk(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path)
        .sort()
        .flatMap((f) => (f === 'node_modules' ? [] : walk(join(path, f))))
    : [path]
}
