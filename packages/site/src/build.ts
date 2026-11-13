import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'dist')

await rm(OUT, { recursive: true, force: true })
await cp(join(ROOT, 'public'), OUT, { recursive: true })
await cp(join(ROOT, '..', 'docs', 'dist', 'client'), join(OUT, 'docs'), { recursive: true })
console.log(`site: the home page, the brand page and the docs in ${OUT}`)
