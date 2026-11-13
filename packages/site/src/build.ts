import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SITE } from './site.ts'

const OUT = join(import.meta.dirname, '..', 'dist')

await rm(OUT, { recursive: true, force: true })
for (const [path, html] of SITE) {
  const file = join(OUT, path === '/' ? 'index.html' : `${path}.html`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, html)
}
console.log(`site: ${SITE.size} pages in ${OUT}`)
