// The App's dist sha256: sha256 over the sorted "sha256  path" lines of every file, like the shell's SHA256SUMS.
// `node scripts/app-sum.ts <dir>...` prints each folder's sum and exits 1 unless they are all the same.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex')

export function appSum(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((each) => each.isFile())
    .map((each) => relative(dir, join(each.parentPath, each.name)).split('\\').join('/')).sort()
  return sha256(files.map((path) => `${sha256(readFileSync(join(dir, path)))}  ${path}\n`).join(''))
}

if (import.meta.main) {
  const dirs = process.argv.slice(2)
  if (!dirs.length) {
    console.error('usage: node scripts/app-sum.ts <dir>...')
    process.exit(2)
  }
  const sums = dirs.map((dir) => appSum(dir))
  dirs.forEach((dir, at) => console.log(`${sums[at]}  ${dir}`))
  if (new Set(sums).size !== 1) {
    console.error('The App differs between these folders.')
    process.exit(1)
  }
}
