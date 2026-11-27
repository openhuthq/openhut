import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiryOf, keptSrc, metaOf, paneWidth, sizeOf } from '../../../src/features/artifacts/artifact.ts'

test('the pane keeps 420px for the chat and at least 360px for itself', () => {
  assert.equal(paneWidth({ total: 1024, fraction: 0.5 }), 512)
  assert.equal(paneWidth({ total: 1024, fraction: 0.9 }), 604)
  assert.equal(paneWidth({ total: 1024, fraction: 0.1 }), 360)
})

test('a card says the kind and who can open it, or the size for a download', () => {
  assert.equal(metaOf({ title: 'Order sync failures', kind: 'page', access: 'private', size: 10 }), 'Page · Private')
  assert.equal(metaOf({ title: 'Notes', kind: 'md', access: 'link', size: 10 }), 'Notes · Anyone with link')
  assert.equal(metaOf({ title: 'failed-orders.csv', kind: 'file', access: 'private', size: 48 * 1024 }), 'CSV · 48 KB')
  assert.equal(metaOf({ title: 'dump', kind: 'file', access: 'team', size: 300 }), 'File · 300 B')
  assert.equal(sizeOf(3 * 1024 * 1024), '3 MB')
})

test('the viewer keeps its signed address until the version changes or it nearly expires', () => {
  const now = Date.UTC(2026, 10, 27, 12)
  const exp = Math.floor(now / 1000) + 3600
  const first = { key: 'art_1:1', src: `/a/art_1/${exp}.abc/index.html` }
  const renewed = `/a/art_1/${exp + 3600}.def/index.html`
  assert.equal(expiryOf(first.src), exp * 1000)
  assert.equal(keptSrc({ kept: first, key: 'art_1:1', src: renewed, now }), first)
  assert.deepEqual(keptSrc({ kept: first, key: 'art_1:2', src: renewed, now }), { key: 'art_1:2', src: renewed })
  assert.deepEqual(keptSrc({ kept: first, key: 'art_1:1', src: renewed, now: exp * 1000 - 5 * 60 * 1000 }), { key: 'art_1:1', src: renewed })
  assert.deepEqual(keptSrc({ kept: undefined, key: 'art_1:1', src: renewed, now }), { key: 'art_1:1', src: renewed })
})
