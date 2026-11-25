// /docs/llms.txt: every page as plain Markdown, in sidebar order, for AI assistants.
import { readFile, writeFile } from 'node:fs/promises'

const dir = new URL('content/docs/', import.meta.url)
const { pages } = JSON.parse(await readFile(new URL('meta.json', dir), 'utf8')) as { pages: string[] }
let out = '# OpenHut docs\n\nSelf-hosted agents for your team. Install: curl -fsSL https://openhut.dev | sh\n'
for (const page of pages.filter((p) => !p.startsWith('---'))) {
  const src = await readFile(new URL(`${page}.mdx`, dir), 'utf8')
  const [, front = '', body = ''] = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? []
  const title = front.match(/^title: (.*)$/m)?.[1]
  const description = front.match(/^description: (.*)$/m)?.[1]
  const text = body.replace(/<\/?(Steps|Step|Cards)>\n?/g, '').replace(/^ *<Card [^>]*title="([^"]*)" href="([^"]*)">(.*?)<\/Card>/gm, '- $1: $3 (https://openhut.dev/docs$2)').replace(/\n{3,}/g, '\n\n').trim()
  out += `\n\n# ${title} (https://openhut.dev/docs/${page === 'index' ? '' : page})\n\n${description}\n\n${text}\n`
}
await writeFile(new URL('dist/client/llms.txt', import.meta.url), out)
console.log('docs: llms.txt')
