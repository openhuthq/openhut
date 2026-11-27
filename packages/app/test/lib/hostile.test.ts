import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { faceArt, parseLook } from '../../src/lib/face.ts'
import { spriteFace } from '../../src/lib/sprite-face.ts'

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  '<iframe src="https://evil.example"></iframe>',
  '"><svg onload=alert(1)>',
  '<style>body{display:none}</style>',
]
const DANGER = /<(script|img|iframe|svg|style)\b|<[^>]*\son\w+=|href="javascript:/i

test('a synced chat message renders hostile strings as text, never as markup', () => {
  for (const text of HOSTILE) {
    const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, `Hi ${text}`))
    assert.doesNotMatch(html, DANGER, text)
  }
})

test('a hostile synced face only ever picks from the built-in parts', () => {
  for (const text of HOSTILE) {
    const look = parseLook({ seed: text, body: text, hair: text, hat: text, eyewear: text, extra: text, bg: text, eyes: 1e9, mouth: -1 })
    assert.ok(look)
    const svg = faceArt({ look, tile: true })
    assert.equal(svg.includes(text), false)
    assert.doesNotMatch(svg, /<script|\son\w+=|javascript:/i)
  }
})

test('a hostile email only picks a built-in sprite', () => {
  for (const text of HOSTILE) {
    const svg = spriteFace(text)
    assert.equal(svg.includes(text), false)
    assert.doesNotMatch(svg, /<script|\son\w+=|javascript:/i)
  }
})

test('raw HTML is set only from art built into the app, never from data', () => {
  const root = new URL('../../src/', import.meta.url)
  const users = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('proto') && readFileSync(new URL(file, root), 'utf8').includes('dangerouslySetInnerHTML'))
  assert.deepEqual(users.sort(), ['components/creature.tsx', 'components/custom/person-face.tsx', 'components/glyph.tsx', 'components/hut.tsx'])
})
