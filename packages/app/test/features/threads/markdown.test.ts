import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { bullets, settled } from '../../../src/features/threads/markdown.ts'

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, settled(text)))

test('a finished table renders as a table, with its inline code', () => {
  const out = html('Versions:\n\n| Page | Says |\n|---|---|\n| Install | `curl x \\| sh` |\n')
  assert.match(out, /<table>.*<th>Page<\/th>.*<td><code>curl x \| sh<\/code><\/td>/s)
})

test('while streaming, a table waits until its delimiter row is in, so its header never shows as a line of pipes first', () => {
  assert.equal(settled('Versions:\n\n| Page | Says |\n'), 'Versions:\n')
  assert.equal(settled('Versions:\n\n| Page | Says |\n|---|--'), 'Versions:\n')
  assert.equal(settled('Versions:\n\n| Pa'), 'Versions:\n')
  assert.equal(settled('| a | b |\n|---|---|\n| 1 | 2'), '| a | b |\n|---|---|\n| 1 | 2')
  assert.doesNotMatch(html('Versions:\n\n| Page | Says |\n'), /\|/)
})

test('fenced code keeps its language class, and a half-streamed fence already renders as a code block', () => {
  assert.match(html('```ts\nconst a = 1\n```'), /<pre><code class="language-ts">const a = 1\n<\/code><\/pre>/)
  const partial = '```ts\nconst answer = await fetch(url)\n| not a table'
  assert.equal(settled(partial), partial)
  assert.match(html(partial), /<pre><code class="language-ts">const answer = await fetch\(url\)\n\| not a table/)
})

test('task lists render checkboxes', () => {
  assert.match(html('- [x] Read the site\n- [ ] Open the PR'), /<ul class="contains-task-list">.*<input type="checkbox" disabled="" checked=""\/> Read the site/s)
})

test('"•" lines an agent writes become a real list instead of running into one paragraph, but not inside code', () => {
  const out = html(bullets('3. Missing:\n   • webhooks\n   • Discord\n\n```\n• kept\n```'))
  assert.match(out, /<li>Missing:\n<ul>\n<li>webhooks<\/li>\n<li>Discord<\/li>/)
  assert.match(out, /<code>• kept\n<\/code>/)
})
