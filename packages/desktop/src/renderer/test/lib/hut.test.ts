import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOODS, hutArt } from '../../src/lib/hut.ts'

test('every mood is the mascot with its parts, and only the prop is new', () => {
  for (const mood of MOODS) {
    const art = hutArt(mood)
    assert.match(art, /^<svg [^>]*viewBox="4 8 100 100">.*<\/svg>$/, mood)
    for (const part of ['c-body', 'c-face', 'c-eyes', 'c-mouth', 'c-hat']) assert.ok(art.includes(`class="${part}"`), `${mood} keeps ${part}`)
    assert.equal(art.split('<g').length, art.split('</g>').length, `${mood} closes every group`)
    assert.equal(art.includes('class="c-prop'), true, `${mood} has a prop`)
  }
})
