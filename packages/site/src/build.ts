import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'dist')

await rm(OUT, { recursive: true, force: true })
await cp(join(ROOT, 'public'), OUT, { recursive: true })
console.log(`site: the home page and the brand page in ${OUT}`)
